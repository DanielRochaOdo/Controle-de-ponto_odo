-- Cada status possui sua própria janela de tolerância antes/depois.
-- Os valores continuam em minutos, mas os limites consideram os segundos completos.
-- Ex.: after = 1 para 08:00 aceita até 08:01:59 e exclui 08:02:00.

alter table public.attendance_settings
  add column if not exists status_tolerances jsonb;

update public.attendance_settings
set status_tolerances = jsonb_build_object(
  'on_time', jsonb_build_object(
    'before', coalesce(on_time_tolerance, 5),
    'after', coalesce(on_time_tolerance, 5)
  ),
  'late', jsonb_build_object(
    'before', coalesce(late_tolerance, 5),
    'after', coalesce(late_tolerance, 5)
  ),
  'late_exit', jsonb_build_object(
    'before', coalesce(late_exit_tolerance, 5),
    'after', coalesce(late_exit_tolerance, 5)
  ),
  'early', jsonb_build_object(
    'before', coalesce(early_tolerance, 5),
    'after', coalesce(early_tolerance, 5)
  ),
  'adjusted', jsonb_build_object(
    'before', coalesce(adjusted_tolerance, 0),
    'after', coalesce(adjusted_tolerance, 0)
  )
)
where status_tolerances is null;

alter table public.attendance_settings
  alter column status_tolerances set default '{
    "on_time":{"before":5,"after":5},
    "late":{"before":5,"after":5},
    "late_exit":{"before":5,"after":5},
    "early":{"before":5,"after":5},
    "adjusted":{"before":0,"after":0}
  }'::jsonb;

alter table public.attendance_settings
  alter column status_tolerances set not null;

create or replace function public.attendance_status_window_contains(
  p_diff_seconds numeric,
  p_status_tolerances jsonb,
  p_status text,
  p_legacy_fallback integer
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  before_minutes integer;
  after_minutes integer;
begin
  before_minutes := greatest(
    0,
    least(
      60,
      coalesce(
        nullif(p_status_tolerances #>> array[p_status, 'before'], '')::integer,
        p_legacy_fallback,
        0
      )
    )
  );

  after_minutes := greatest(
    0,
    least(
      60,
      coalesce(
        nullif(p_status_tolerances #>> array[p_status, 'after'], '')::integer,
        p_legacy_fallback,
        0
      )
    )
  );

  return p_diff_seconds >= -(before_minutes * 60)
     and p_diff_seconds < ((after_minutes + 1) * 60);
end;
$$;

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
  late_status text;
  late_fallback integer;
begin
  if p_current_status = 'adjusted' then
    return 'adjusted';
  end if;

  if p_expected is null or p_actual is null then
    return null;
  end if;

  diff_seconds := extract(epoch from (p_actual - p_expected));
  late_status := case when p_is_exit then 'late_exit' else 'late' end;
  late_fallback := case when p_is_exit then p_late_exit_tolerance else p_late_tolerance end;

  -- Em sobreposição, "No horário" tem prioridade.
  if public.attendance_status_window_contains(
    diff_seconds,
    p_status_tolerances,
    'on_time',
    coalesce(p_on_time_tolerance, 5)
  ) then
    return 'on_time';
  end if;

  -- Fora da janela de "No horário", a direção da batida define a prioridade.
  -- A janela do próprio status é consultada antes do fallback direcional.
  if diff_seconds < 0 then
    if public.attendance_status_window_contains(
      diff_seconds,
      p_status_tolerances,
      'early',
      coalesce(p_early_tolerance, 5)
    ) then
      return 'early';
    end if;

    if public.attendance_status_window_contains(
      diff_seconds,
      p_status_tolerances,
      late_status,
      coalesce(late_fallback, 5)
    ) then
      return late_status;
    end if;

    return 'early';
  end if;

  if diff_seconds > 0 then
    if public.attendance_status_window_contains(
      diff_seconds,
      p_status_tolerances,
      late_status,
      coalesce(late_fallback, 5)
    ) then
      return late_status;
    end if;

    if public.attendance_status_window_contains(
      diff_seconds,
      p_status_tolerances,
      'early',
      coalesce(p_early_tolerance, 5)
    ) then
      return 'early';
    end if;

    return late_status;
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
  s public.attendance_settings%rowtype;
  cfg jsonb;
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

  new.entry_status := public.classify_attendance_mark(
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

  new.exit_status := public.classify_attendance_mark(
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

  return new;
end;
$$;

drop trigger if exists attendance_days_apply_status_tolerances on public.attendance_days;
create trigger attendance_days_apply_status_tolerances
before insert or update of scheduled_entry, scheduled_exit, actual_entry, actual_exit, entry_status, exit_status
on public.attendance_days
for each row
execute function public.apply_attendance_status_tolerances();

create or replace function public.recalculate_attendance(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.attendance_settings%rowtype;
  cfg jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;

  select * into s
  from public.attendance_settings
  where user_id = p_user_id;

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

  update public.attendance_days
  set entry_status = public.classify_attendance_mark(
        scheduled_entry,
        actual_entry,
        entry_status,
        false,
        cfg,
        coalesce(s.on_time_tolerance, 5),
        coalesce(s.late_tolerance, 5),
        coalesce(s.late_exit_tolerance, 5),
        coalesce(s.early_tolerance, 5)
      ),
      exit_status = public.classify_attendance_mark(
        scheduled_exit,
        actual_exit,
        exit_status,
        true,
        cfg,
        coalesce(s.on_time_tolerance, 5),
        coalesce(s.late_tolerance, 5),
        coalesce(s.late_exit_tolerance, 5),
        coalesce(s.early_tolerance, 5)
      )
  where user_id = p_user_id;
end;
$$;

grant execute on function public.recalculate_attendance(uuid) to authenticated;

comment on column public.attendance_settings.status_tolerances is
  'Janela de tolerância antes/depois, em minutos, para cada status de ponto.';

comment on function public.classify_attendance_mark(time, time, text, boolean, jsonb, integer, integer, integer, integer) is
  'Classifica uma batida usando janelas por status e precisão de segundos.';
