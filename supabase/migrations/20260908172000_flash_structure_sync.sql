-- Estrutura cadastral da Flash sincronizada manualmente.
-- Dados de colaboradores, departamentos e alocações de escala mudam com baixa frequência
-- e são reutilizados pela importação diária/mensal de marcações.

create table if not exists public.flash_departments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flash_department_id text not null,
  name text not null,
  description text,
  external_id text,
  is_active boolean,
  raw_payload jsonb,
  synced_at timestamptz not null default now(),
  unique (user_id, flash_department_id)
);

create table if not exists public.flash_employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flash_employee_id text not null,
  external_id text,
  employee_name text not null,
  status text,
  flash_department_id text,
  department_name text,
  raw_payload jsonb,
  synced_at timestamptz not null default now(),
  unique (user_id, flash_employee_id)
);

create table if not exists public.employee_schedule_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  flash_employee_id text not null,
  external_id text,
  employee_name text,
  timetable_id bigint,
  timetable_name text,
  allocation_id bigint,
  allocation_start_date date,
  scheduled_entry time,
  break_start time,
  break_end time,
  scheduled_exit time,
  schedule_times jsonb not null default '[]'::jsonb,
  raw_payload jsonb,
  synced_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create table if not exists public.flash_structure_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('running','completed','failed')),
  employees_processed integer not null default 0,
  departments_processed integer not null default 0,
  allocations_processed integer not null default 0,
  warning_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists flash_employees_user_name_idx
  on public.flash_employees (user_id, employee_name);
create index if not exists flash_employees_user_external_idx
  on public.flash_employees (user_id, external_id);
create index if not exists flash_departments_user_name_idx
  on public.flash_departments (user_id, name);
create index if not exists employee_schedule_employee_start_idx
  on public.employee_schedule_allocations (user_id, flash_employee_id, allocation_start_date desc);
create index if not exists flash_structure_sync_runs_user_started_idx
  on public.flash_structure_sync_runs (user_id, started_at desc);

alter table public.flash_departments enable row level security;
alter table public.flash_employees enable row level security;
alter table public.employee_schedule_allocations enable row level security;
alter table public.flash_structure_sync_runs enable row level security;

do $$ begin
  create policy "flash_departments_select_own" on public.flash_departments
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "flash_employees_select_own" on public.flash_employees
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "employee_schedule_allocations_select_own" on public.employee_schedule_allocations
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "flash_structure_sync_runs_select_own" on public.flash_structure_sync_runs
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

comment on table public.flash_departments is 'Departamentos sincronizados manualmente da Flash.';
comment on table public.flash_employees is 'Colaboradores sincronizados manualmente da Flash.';
comment on table public.employee_schedule_allocations is 'Histórico de alocações de escala por colaborador, usado para comparar previsto x realizado.';
comment on table public.flash_structure_sync_runs is 'Auditoria das sincronizações cadastrais da Flash.';
