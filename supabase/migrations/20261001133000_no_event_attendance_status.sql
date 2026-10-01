-- Ausência sem evento: quando há jornada prevista, nenhuma batida e nenhum
-- evento Flash cobrindo o dia, ambos os status passam a "no_event".
-- A existência do evento é global porque managers não acessam/sincronizam o
-- módulo Eventos; usamos apenas a existência, sem expor o conteúdo do evento.

alter table public.attendance_days
  drop constraint if exists attendance_days_entry_status_check,
  drop constraint if exists attendance_days_exit_status_check;

alter table public.attendance_days
  add constraint attendance_days_entry_status_check
    check (entry_status is null or entry_status in ('on_time','late','late_exit','early','adjusted','no_event')),
  add constraint attendance_days_exit_status_check
    check (exit_status is null or exit_status in ('on_time','late','late_exit','early','adjusted','no_event'));

create or replace function public.attendance_has_registered_event(
  p_company_id text,
  p_employee_id text,
  p_work_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_company_id is not null
    and p_employee_id is not null
    and p_work_date is not null
    and exists (
      select 1
      from public.flash_events e
      where e.flash_company_id = p_company_id
        and p_work_date between
          coalesce(e.start_at::date, e.event_date)
          and coalesce(e.end_at::date, e.start_at::date, e.event_date)
        and (
          e.flash_employee_id = p_employee_id
          or (
            e.external_id is not null
            and exists (
              select 1
              from public.flash_employees employee
              where employee.flash_company_id = p_company_id
                and employee.flash_employee_id = p_employee_id
                and employee.external_id = e.external_id
            )
          )
        )
    );
$$;

-- Esta função só é usada pelas rotinas SECURITY DEFINER abaixo.
-- Não permitimos que usuários consultem a existência de eventos arbitrários.
revoke all on function public.attendance_has_registered_event(text, text, date) from public;
revoke all on function public.attendance_has_registered_event(text, text, date) from anon;
revoke all on function public.attendance_has_registered_event(text, text, date) from authenticated;

create or replace function public.apply_attendance_status_tolerances()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.attendance_settings%rowtype;
  cfg jsonb;
  classified_entry text;
  classified_exit text;
begin
  select * into s
  from public.attendance_settings
  where user_id = new.user_id;

  cfg := coalesce(
    s.status_tolerances,
    '{
      "on_time":{"before":5,"after":5},
      "late":{"before":5,"after":5},
      "late_exit":{"before":5,"after":5},
      "early":{"before":5,"after":5},
      "adjusted":{"before":0,"after":0}
    }'::jsonb
  );

  classified_entry := public.classify_attendance_mark(
    new.scheduled_entry,
    new.actual_entry,
    new.entry_status,
    false,
    cfg,
    coalesce(s.on_time_tolerance, 5),
    coalesce(s.late_tolerance, 5),
    coalesce(s.late_exit_tolerance, 5),
    coalesce(s.early_tolerance, 5)
  );

  classified_exit := public.classify_attendance_mark(
    new.scheduled_exit,
    new.actual_exit,
    new.exit_status,
    true,
    cfg,
    coalesce(s.on_time_tolerance, 5),
    coalesce(s.late_tolerance, 5),
    coalesce(s.late_exit_tolerance, 5),
    coalesce(s.early_tolerance, 5)
  );

  if new.actual_entry is null
     and new.actual_exit is null
     and (new.scheduled_entry is not null or new.scheduled_exit is not null)
     and classified_entry is null
     and classified_exit is null then
    if public.attendance_has_registered_event(
      new.flash_company_id,
      new.flash_employee_id,
      new.work_date
    ) then
      new.entry_status := null;
      new.exit_status := null;
    else
      new.entry_status := 'no_event';
      new.exit_status := 'no_event';
    end if;
  else
    new.entry_status := classified_entry;
    new.exit_status := classified_exit;
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_days_apply_status_tolerances on public.attendance_days;
create trigger attendance_days_apply_status_tolerances
before insert or update of scheduled_entry, scheduled_exit, actual_entry, actual_exit, entry_status, exit_status
on public.attendance_days
for each row
execute function public.apply_attendance_status_tolerances();

-- Uma única fonte de regra: o recálculo apenas força as linhas pelo mesmo trigger
-- usado nas importações, evitando duplicar a classificação em outra função.
create or replace function public.recalculate_attendance(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;

  update public.attendance_days
  set entry_status = entry_status,
      exit_status = exit_status
  where user_id = p_user_id;
end;
$$;

grant execute on function public.recalculate_attendance(uuid) to authenticated;

-- Eventos podem ser sincronizados depois dos registros. Quando um evento entra,
-- muda ou é removido, recalculamos somente o colaborador e o intervalo afetados.
create or replace function public.refresh_attendance_status_for_event_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    update public.attendance_days a
    set entry_status = a.entry_status,
        exit_status = a.exit_status
    where a.flash_company_id = old.flash_company_id
      and a.actual_entry is null
      and a.actual_exit is null
      and a.work_date between
        coalesce(old.start_at::date, old.event_date)
        and coalesce(old.end_at::date, old.start_at::date, old.event_date)
      and (
        a.flash_employee_id = old.flash_employee_id
        or (
          old.external_id is not null
          and exists (
            select 1
            from public.flash_employees employee
            where employee.flash_company_id = old.flash_company_id
              and employee.flash_employee_id = a.flash_employee_id
              and employee.external_id = old.external_id
          )
        )
      );
  end if;

  if tg_op <> 'DELETE' then
    update public.attendance_days a
    set entry_status = a.entry_status,
        exit_status = a.exit_status
    where a.flash_company_id = new.flash_company_id
      and a.actual_entry is null
      and a.actual_exit is null
      and a.work_date between
        coalesce(new.start_at::date, new.event_date)
        and coalesce(new.end_at::date, new.start_at::date, new.event_date)
      and (
        a.flash_employee_id = new.flash_employee_id
        or (
          new.external_id is not null
          and exists (
            select 1
            from public.flash_employees employee
            where employee.flash_company_id = new.flash_company_id
              and employee.flash_employee_id = a.flash_employee_id
              and employee.external_id = new.external_id
          )
        )
      );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists flash_events_refresh_attendance_status on public.flash_events;
create trigger flash_events_refresh_attendance_status
after insert or update or delete on public.flash_events
for each row
execute function public.refresh_attendance_status_for_event_change();

-- Classifica o histórico já importado. A trigger verifica eventos existentes e
-- só marca no_event quando há jornada prevista e as duas batidas estão ausentes.
update public.attendance_days
set entry_status = entry_status,
    exit_status = exit_status
where actual_entry is null
  and actual_exit is null
  and (scheduled_entry is not null or scheduled_exit is not null);

comment on function public.attendance_has_registered_event(text, text, date) is
  'Verifica internamente se existe evento Flash cobrindo o dia do colaborador, sem expor dados do evento.';
comment on function public.apply_attendance_status_tolerances() is
  'Fonte única da classificação: tolerâncias direcionais, adjusted e ausência sem evento.';
