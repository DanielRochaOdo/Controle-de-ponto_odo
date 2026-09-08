-- Suporte a múltiplas empresas Flash.
-- A empresa de origem passa a fazer parte da identidade dos dados sincronizados e dos registros de ponto.

alter table public.attendance_days
  add column if not exists flash_company_id text,
  add column if not exists company_key text,
  add column if not exists company_name text,
  add column if not exists company_cnpj text;

alter table public.flash_employees
  add column if not exists flash_company_id text,
  add column if not exists company_key text,
  add column if not exists company_name text,
  add column if not exists company_cnpj text;

alter table public.flash_departments
  add column if not exists flash_company_id text,
  add column if not exists company_key text,
  add column if not exists company_name text,
  add column if not exists company_cnpj text;

alter table public.employee_schedule_allocations
  add column if not exists flash_company_id text,
  add column if not exists company_key text,
  add column if not exists company_name text,
  add column if not exists company_cnpj text;

alter table public.flash_structure_sync_runs
  add column if not exists companies_processed integer not null default 0;

alter table public.flash_import_runs
  add column if not exists companies_processed integer not null default 0;

-- As constraints antigas assumiam uma única empresa por usuário.
alter table public.flash_employees
  drop constraint if exists flash_employees_user_id_flash_employee_id_key;

alter table public.flash_departments
  drop constraint if exists flash_departments_user_id_flash_department_id_key;

alter table public.flash_employees
  drop constraint if exists flash_employees_user_company_employee_key;
alter table public.flash_employees
  add constraint flash_employees_user_company_employee_key
  unique (user_id, flash_company_id, flash_employee_id);

alter table public.flash_departments
  drop constraint if exists flash_departments_user_company_department_key;
alter table public.flash_departments
  add constraint flash_departments_user_company_department_key
  unique (user_id, flash_company_id, flash_department_id);

create index if not exists attendance_days_user_company_date_idx
  on public.attendance_days (user_id, flash_company_id, work_date desc);

create index if not exists flash_employees_user_company_name_idx
  on public.flash_employees (user_id, flash_company_id, employee_name);

create index if not exists flash_departments_user_company_name_idx
  on public.flash_departments (user_id, flash_company_id, name);

create index if not exists employee_schedule_company_employee_start_idx
  on public.employee_schedule_allocations (user_id, flash_company_id, flash_employee_id, allocation_start_date desc);

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
    'departments', coalesce((select jsonb_agg(department order by department) from (select distinct department from public.attendance_days where user_id = p_user_id and department is not null) d), '[]'::jsonb),
    'companies', coalesce((select jsonb_agg(company_name order by company_name) from (select distinct company_name from public.attendance_days where user_id = p_user_id and company_name is not null) c), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_attendance_filter_options(uuid) to authenticated;

comment on column public.attendance_days.flash_company_id is 'Company ID da Flash que originou a marcação.';
comment on column public.flash_employees.flash_company_id is 'Company ID da Flash à qual o colaborador pertence.';
comment on column public.flash_departments.flash_company_id is 'Company ID da Flash à qual o departamento pertence.';
comment on column public.employee_schedule_allocations.flash_company_id is 'Company ID da Flash à qual a alocação pertence.';
