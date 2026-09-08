-- Arquitetura simplificada para importação manual da Flash API.
-- A Flash é a origem; attendance_days é o read model usado por Dashboard, Registros e Excel.

create table if not exists public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  import_run_id uuid,
  source_key text not null,
  flash_employee_id text,
  employee_name text not null,
  department text,
  work_date date not null,
  scheduled_entry time,
  scheduled_exit time,
  actual_entry time,
  actual_exit time,
  entry_status text check (entry_status is null or entry_status in ('on_time','late','late_exit','early','adjusted')),
  exit_status text check (exit_status is null or exit_status in ('on_time','late','late_exit','early','adjusted')),
  raw_payload jsonb,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create index if not exists attendance_days_user_date_idx on public.attendance_days (user_id, work_date desc);
create index if not exists attendance_days_user_employee_idx on public.attendance_days (user_id, employee_name);
create index if not exists attendance_days_user_department_idx on public.attendance_days (user_id, department);

create table if not exists public.attendance_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  on_time_tolerance integer not null default 5 check (on_time_tolerance between 0 and 60),
  late_tolerance integer not null default 5 check (late_tolerance between 0 and 60),
  late_exit_tolerance integer not null default 5 check (late_exit_tolerance between 0 and 60),
  early_tolerance integer not null default 5 check (early_tolerance between 0 and 60),
  adjusted_tolerance integer not null default 0 check (adjusted_tolerance between 0 and 60),
  status_colors jsonb not null default '{"on_time":"#22c55e","late":"#ef4444","late_exit":"#f97316","early":"#3b82f6","adjusted":"#eab308"}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.flash_import_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status text not null check (status in ('running','completed','failed')),
  employees_processed integer not null default 0,
  records_processed integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.attendance_days enable row level security;
alter table public.attendance_settings enable row level security;
alter table public.flash_import_runs enable row level security;

do $$ begin create policy "attendance_days_select_own" on public.attendance_days for select using (auth.uid() = user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy "attendance_settings_select_own" on public.attendance_settings for select using (auth.uid() = user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy "attendance_settings_insert_own" on public.attendance_settings for insert with check (auth.uid() = user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy "attendance_settings_update_own" on public.attendance_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy "flash_import_runs_select_own" on public.flash_import_runs for select using (auth.uid() = user_id); exception when duplicate_object then null; end $$;

create or replace function public.get_attendance_filter_options(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'employees', coalesce((select jsonb_agg(employee_name order by employee_name) from (select distinct employee_name from public.attendance_days where user_id = p_user_id and employee_name is not null) e), '[]'::jsonb),
    'departments', coalesce((select jsonb_agg(department order by department) from (select distinct department from public.attendance_days where user_id = p_user_id and department is not null) d), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_attendance_filter_options(uuid) to authenticated;

create or replace function public.recalculate_attendance(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.attendance_settings%rowtype;
  entry_diff numeric;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not authorized'; end if;

  select * into s from public.attendance_settings where user_id = p_user_id;
  if not found then
    s.on_time_tolerance := 5;
    s.late_tolerance := 5;
    s.late_exit_tolerance := 5;
    s.early_tolerance := 5;
    s.adjusted_tolerance := 0;
  end if;

  update public.attendance_days
  set entry_status = case
        when entry_status = 'adjusted' then 'adjusted'
        when actual_entry is null or scheduled_entry is null then null
        when abs(extract(epoch from (actual_entry - scheduled_entry)) / 60) <= s.on_time_tolerance then 'on_time'
        when extract(epoch from (actual_entry - scheduled_entry)) / 60 < -s.early_tolerance then 'early'
        when extract(epoch from (actual_entry - scheduled_entry)) / 60 > s.late_tolerance then 'late'
        else 'on_time'
      end,
      exit_status = case
        when exit_status = 'adjusted' then 'adjusted'
        when actual_exit is null or scheduled_exit is null then null
        when abs(extract(epoch from (actual_exit - scheduled_exit)) / 60) <= s.on_time_tolerance then 'on_time'
        when extract(epoch from (actual_exit - scheduled_exit)) / 60 < -s.early_tolerance then 'early'
        when extract(epoch from (actual_exit - scheduled_exit)) / 60 > s.late_exit_tolerance then 'late_exit'
        else 'on_time'
      end
  where user_id = p_user_id;
end;
$$;

grant execute on function public.recalculate_attendance(uuid) to authenticated;

comment on table public.attendance_days is 'Resumo diário de jornada importado manualmente da Flash API.';
comment on table public.attendance_settings is 'Tolerâncias e cores usadas na classificação e exportação.';
comment on table public.flash_import_runs is 'Auditoria das importações manuais executadas pelo usuário.';
