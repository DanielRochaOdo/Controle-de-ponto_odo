-- A tolerância pertence à instalação, não ao usuário que importou o registro.
-- A linha existente mais recente inicia a configuração compartilhada.
create table if not exists public.attendance_global_settings (
  singleton boolean primary key default true check (singleton),
  status_tolerances jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.attendance_global_settings enable row level security;
grant select, insert, update on public.attendance_global_settings to authenticated;

drop policy if exists attendance_global_settings_select_authenticated on public.attendance_global_settings;
create policy attendance_global_settings_select_authenticated
  on public.attendance_global_settings
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists attendance_global_settings_insert_admin on public.attendance_global_settings;
create policy attendance_global_settings_insert_admin
  on public.attendance_global_settings
  for insert
  to authenticated
  with check (public.is_admin() and updated_by = auth.uid());

drop policy if exists attendance_global_settings_update_admin on public.attendance_global_settings;
create policy attendance_global_settings_update_admin
  on public.attendance_global_settings
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin() and updated_by = auth.uid());

insert into public.attendance_global_settings (singleton, status_tolerances, updated_by, updated_at)
values (
  true,
  coalesce(
    (select status_tolerances from public.attendance_settings order by updated_at desc limit 1),
    '{
      "on_time":{"before":5,"after":5},
      "late":{"before":5,"after":5},
      "late_exit":{"before":5,"after":5},
      "early":{"before":5,"after":5},
      "adjusted":{"before":0,"after":0}
    }'::jsonb
  ),
  (select user_id from public.attendance_settings order by updated_at desc limit 1),
  coalesce((select updated_at from public.attendance_settings order by updated_at desc limit 1), now())
)
on conflict (singleton) do nothing;

-- Com tolerância zero, qualquer segundo após o horário previsto é atraso.
-- Tolerâncias positivas mantêm a janela do minuto inteiro descrita na tela.
create or replace function public.classify_attendance_mark(
  p_expected time,
  p_actual time,
  p_current_status text,
  p_is_exit boolean,
  p_status_tolerances jsonb,
  p_on_time_tolerance integer,
  p_late_tolerance integer,
  p_late_exit_tolerance integer,
  p_early_tolerance integer
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  diff_seconds numeric;
  early_minutes integer;
  after_minutes integer;
begin
  if p_current_status = 'adjusted' then
    return 'adjusted';
  end if;

  if p_expected is null or p_actual is null then
    return null;
  end if;

  early_minutes := greatest(0, least(60,
    coalesce(nullif(p_status_tolerances #>> '{early,before}', '')::integer, p_early_tolerance, 5)
  ));
  if p_is_exit then
    after_minutes := greatest(0, least(60,
      coalesce(nullif(p_status_tolerances #>> '{late_exit,after}', '')::integer, p_late_exit_tolerance, 5)
    ));
  else
    after_minutes := greatest(0, least(60,
      coalesce(nullif(p_status_tolerances #>> '{late,after}', '')::integer, p_late_tolerance, 5)
    ));
  end if;

  diff_seconds := extract(epoch from (p_actual - p_expected));

  if diff_seconds < -(early_minutes * 60) then
    return 'early';
  end if;

  if (after_minutes = 0 and diff_seconds > 0)
     or diff_seconds >= ((after_minutes + 1) * 60) then
    return case when p_is_exit then 'late_exit' else 'late' end;
  end if;

  return 'on_time';
end;
$$;

create or replace function public.apply_attendance_status_tolerances()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.attendance_global_settings%rowtype;
  cfg jsonb;
  classified_entry text;
  classified_exit text;
begin
  select * into s
  from public.attendance_global_settings
  where singleton = true;

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
    5,
    5,
    5,
    5
  );

  classified_exit := public.classify_attendance_mark(
    new.scheduled_exit,
    new.actual_exit,
    new.exit_status,
    true,
    cfg,
    5,
    5,
    5,
    5
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

create or replace function public.recalculate_all_attendance_statuses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status_tolerances is not distinct from old.status_tolerances then
    return new;
  end if;

  update public.attendance_days
  set entry_status = entry_status,
      exit_status = exit_status;

  return new;
end;
$$;

revoke all on function public.recalculate_all_attendance_statuses() from public, anon, authenticated;

drop trigger if exists attendance_global_settings_recalculate on public.attendance_global_settings;
create trigger attendance_global_settings_recalculate
after insert or update of status_tolerances on public.attendance_global_settings
for each row
execute function public.recalculate_all_attendance_statuses();

-- Atualiza registros de todas as contas com a configuração compartilhada.
update public.attendance_days
set entry_status = entry_status,
    exit_status = exit_status;

comment on table public.attendance_global_settings is
  'Tolerâncias de ponto compartilhadas por todos os usuários da instalação.';
comment on function public.classify_attendance_mark(
  time, time, text, boolean, jsonb, integer, integer, integer, integer
) is 'Classifica tolerâncias direcionais. Com zero minuto, qualquer segundo após o previsto é atraso; adjusted mantém prioridade.';
comment on function public.apply_attendance_status_tolerances() is
  'Classifica registros usando as tolerâncias globais, mantendo eventos sem batida e ajustes Flash.';
