-- A estrutura cadastral da Flash é global para o sistema.
-- Mantemos o modelo atual com user_id para evitar uma refatoração ampla,
-- mas replicamos automaticamente funcionários, departamentos, horários e
-- o último histórico concluído de sincronização para todas as contas.
-- Assim, uma sincronização feita por qualquer admin passa a valer para todos.

-- ---------------------------------------------------------------------------
-- 1. Histórico de sincronização: identifica cópias de uma execução original.
-- ---------------------------------------------------------------------------
alter table public.flash_structure_sync_runs
  add column if not exists source_run_id uuid;

do $$
begin
  alter table public.flash_structure_sync_runs
    add constraint flash_structure_sync_runs_user_source_run_key
    unique (user_id, source_run_id);
exception when duplicate_object then null;
end $$;

comment on column public.flash_structure_sync_runs.source_run_id is
  'ID da execução original quando este registro é uma cópia compartilhada com outra conta.';

-- ---------------------------------------------------------------------------
-- 2. Backfill imediato para contas que já existem.
--    Para cada entidade Flash usamos a versão sincronizada mais recente.
-- ---------------------------------------------------------------------------
insert into public.flash_employees (
  user_id,
  flash_employee_id,
  external_id,
  employee_name,
  status,
  flash_department_id,
  department_name,
  raw_payload,
  synced_at,
  flash_company_id,
  company_key,
  company_name,
  company_cnpj
)
select
  u.id,
  src.flash_employee_id,
  src.external_id,
  src.employee_name,
  src.status,
  src.flash_department_id,
  src.department_name,
  src.raw_payload,
  src.synced_at,
  src.flash_company_id,
  src.company_key,
  src.company_name,
  src.company_cnpj
from auth.users u
cross join (
  select distinct on (flash_company_id, flash_employee_id)
    flash_employee_id,
    external_id,
    employee_name,
    status,
    flash_department_id,
    department_name,
    raw_payload,
    synced_at,
    flash_company_id,
    company_key,
    company_name,
    company_cnpj
  from public.flash_employees
  where flash_company_id is not null
  order by flash_company_id, flash_employee_id, synced_at desc, id desc
) src
on conflict (user_id, flash_company_id, flash_employee_id)
do update set
  external_id = excluded.external_id,
  employee_name = excluded.employee_name,
  status = excluded.status,
  flash_department_id = excluded.flash_department_id,
  department_name = excluded.department_name,
  raw_payload = excluded.raw_payload,
  synced_at = excluded.synced_at,
  company_key = excluded.company_key,
  company_name = excluded.company_name,
  company_cnpj = excluded.company_cnpj;

insert into public.flash_departments (
  user_id,
  flash_department_id,
  name,
  description,
  external_id,
  is_active,
  raw_payload,
  synced_at,
  flash_company_id,
  company_key,
  company_name,
  company_cnpj
)
select
  u.id,
  src.flash_department_id,
  src.name,
  src.description,
  src.external_id,
  src.is_active,
  src.raw_payload,
  src.synced_at,
  src.flash_company_id,
  src.company_key,
  src.company_name,
  src.company_cnpj
from auth.users u
cross join (
  select distinct on (flash_company_id, flash_department_id)
    flash_department_id,
    name,
    description,
    external_id,
    is_active,
    raw_payload,
    synced_at,
    flash_company_id,
    company_key,
    company_name,
    company_cnpj
  from public.flash_departments
  where flash_company_id is not null
  order by flash_company_id, flash_department_id, synced_at desc, id desc
) src
on conflict (user_id, flash_company_id, flash_department_id)
do update set
  name = excluded.name,
  description = excluded.description,
  external_id = excluded.external_id,
  is_active = excluded.is_active,
  raw_payload = excluded.raw_payload,
  synced_at = excluded.synced_at,
  company_key = excluded.company_key,
  company_name = excluded.company_name,
  company_cnpj = excluded.company_cnpj;

insert into public.employee_schedule_allocations (
  user_id,
  source_key,
  flash_employee_id,
  external_id,
  employee_name,
  timetable_id,
  timetable_name,
  allocation_id,
  allocation_start_date,
  scheduled_entry,
  break_start,
  break_end,
  scheduled_exit,
  schedule_times,
  raw_payload,
  synced_at,
  flash_company_id,
  company_key,
  company_name,
  company_cnpj
)
select
  u.id,
  src.source_key,
  src.flash_employee_id,
  src.external_id,
  src.employee_name,
  src.timetable_id,
  src.timetable_name,
  src.allocation_id,
  src.allocation_start_date,
  src.scheduled_entry,
  src.break_start,
  src.break_end,
  src.scheduled_exit,
  src.schedule_times,
  src.raw_payload,
  src.synced_at,
  src.flash_company_id,
  src.company_key,
  src.company_name,
  src.company_cnpj
from auth.users u
cross join (
  select distinct on (source_key)
    source_key,
    flash_employee_id,
    external_id,
    employee_name,
    timetable_id,
    timetable_name,
    allocation_id,
    allocation_start_date,
    scheduled_entry,
    break_start,
    break_end,
    scheduled_exit,
    schedule_times,
    raw_payload,
    synced_at,
    flash_company_id,
    company_key,
    company_name,
    company_cnpj
  from public.employee_schedule_allocations
  order by source_key, synced_at desc, id desc
) src
on conflict (user_id, source_key)
do update set
  flash_employee_id = excluded.flash_employee_id,
  external_id = excluded.external_id,
  employee_name = excluded.employee_name,
  timetable_id = excluded.timetable_id,
  timetable_name = excluded.timetable_name,
  allocation_id = excluded.allocation_id,
  allocation_start_date = excluded.allocation_start_date,
  scheduled_entry = excluded.scheduled_entry,
  break_start = excluded.break_start,
  break_end = excluded.break_end,
  scheduled_exit = excluded.scheduled_exit,
  schedule_times = excluded.schedule_times,
  raw_payload = excluded.raw_payload,
  synced_at = excluded.synced_at,
  flash_company_id = excluded.flash_company_id,
  company_key = excluded.company_key,
  company_name = excluded.company_name,
  company_cnpj = excluded.company_cnpj;

-- Replica o último run concluído de cada empresa/recurso para que qualquer conta
-- reconheça a estrutura como sincronizada, inclusive no import de registros.
insert into public.flash_structure_sync_runs (
  id,
  user_id,
  status,
  employees_processed,
  departments_processed,
  allocations_processed,
  warning_count,
  error_message,
  started_at,
  finished_at,
  companies_processed,
  companies_total,
  current_company_index,
  current_company_name,
  current_stage,
  current_company_employees_total,
  current_company_employees_processed,
  progress_updated_at,
  flash_company_id,
  company_key,
  company_name,
  company_cnpj,
  sync_target,
  source_run_id
)
select
  gen_random_uuid(),
  u.id,
  src.status,
  src.employees_processed,
  src.departments_processed,
  src.allocations_processed,
  src.warning_count,
  src.error_message,
  src.started_at,
  src.finished_at,
  src.companies_processed,
  src.companies_total,
  src.current_company_index,
  src.current_company_name,
  src.current_stage,
  src.current_company_employees_total,
  src.current_company_employees_processed,
  src.progress_updated_at,
  src.flash_company_id,
  src.company_key,
  src.company_name,
  src.company_cnpj,
  src.sync_target,
  src.id
from auth.users u
cross join (
  select distinct on (company_key, sync_target)
    id,
    status,
    employees_processed,
    departments_processed,
    allocations_processed,
    warning_count,
    error_message,
    started_at,
    finished_at,
    companies_processed,
    companies_total,
    current_company_index,
    current_company_name,
    current_stage,
    current_company_employees_total,
    current_company_employees_processed,
    progress_updated_at,
    flash_company_id,
    company_key,
    company_name,
    company_cnpj,
    sync_target
  from public.flash_structure_sync_runs
  where status = 'completed'
    and source_run_id is null
    and company_key is not null
    and sync_target is not null
  order by company_key, sync_target, finished_at desc nulls last, started_at desc
) src
where u.id <> (
  select r.user_id
  from public.flash_structure_sync_runs r
  where r.id = src.id
)
on conflict (user_id, source_run_id)
do update set
  status = excluded.status,
  employees_processed = excluded.employees_processed,
  departments_processed = excluded.departments_processed,
  allocations_processed = excluded.allocations_processed,
  warning_count = excluded.warning_count,
  error_message = excluded.error_message,
  started_at = excluded.started_at,
  finished_at = excluded.finished_at,
  companies_processed = excluded.companies_processed,
  companies_total = excluded.companies_total,
  current_company_index = excluded.current_company_index,
  current_company_name = excluded.current_company_name,
  current_stage = excluded.current_stage,
  current_company_employees_total = excluded.current_company_employees_total,
  current_company_employees_processed = excluded.current_company_employees_processed,
  progress_updated_at = excluded.progress_updated_at,
  flash_company_id = excluded.flash_company_id,
  company_key = excluded.company_key,
  company_name = excluded.company_name,
  company_cnpj = excluded.company_cnpj,
  sync_target = excluded.sync_target;

-- ---------------------------------------------------------------------------
-- 3. Propagação automática de alterações futuras.
-- ---------------------------------------------------------------------------
create or replace function public.propagate_flash_employee_to_all_users()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    delete from public.flash_employees
    where user_id <> old.user_id
      and flash_company_id is not distinct from old.flash_company_id
      and flash_employee_id = old.flash_employee_id;
    return old;
  end if;

  if tg_op = 'UPDATE' and (
    old.flash_company_id is distinct from new.flash_company_id
    or old.flash_employee_id is distinct from new.flash_employee_id
  ) then
    delete from public.flash_employees
    where user_id <> old.user_id
      and flash_company_id is not distinct from old.flash_company_id
      and flash_employee_id = old.flash_employee_id;
  end if;

  if new.flash_company_id is null then return new; end if;

  insert into public.flash_employees (
    user_id, flash_employee_id, external_id, employee_name, status,
    flash_department_id, department_name, raw_payload, synced_at,
    flash_company_id, company_key, company_name, company_cnpj
  )
  select
    u.id, new.flash_employee_id, new.external_id, new.employee_name, new.status,
    new.flash_department_id, new.department_name, new.raw_payload, new.synced_at,
    new.flash_company_id, new.company_key, new.company_name, new.company_cnpj
  from auth.users u
  where u.id <> new.user_id
  on conflict (user_id, flash_company_id, flash_employee_id)
  do update set
    external_id = excluded.external_id,
    employee_name = excluded.employee_name,
    status = excluded.status,
    flash_department_id = excluded.flash_department_id,
    department_name = excluded.department_name,
    raw_payload = excluded.raw_payload,
    synced_at = excluded.synced_at,
    company_key = excluded.company_key,
    company_name = excluded.company_name,
    company_cnpj = excluded.company_cnpj;

  return new;
end;
$$;

create or replace function public.propagate_flash_department_to_all_users()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    delete from public.flash_departments
    where user_id <> old.user_id
      and flash_company_id is not distinct from old.flash_company_id
      and flash_department_id = old.flash_department_id;
    return old;
  end if;

  if tg_op = 'UPDATE' and (
    old.flash_company_id is distinct from new.flash_company_id
    or old.flash_department_id is distinct from new.flash_department_id
  ) then
    delete from public.flash_departments
    where user_id <> old.user_id
      and flash_company_id is not distinct from old.flash_company_id
      and flash_department_id = old.flash_department_id;
  end if;

  if new.flash_company_id is null then return new; end if;

  insert into public.flash_departments (
    user_id, flash_department_id, name, description, external_id, is_active,
    raw_payload, synced_at, flash_company_id, company_key, company_name, company_cnpj
  )
  select
    u.id, new.flash_department_id, new.name, new.description, new.external_id, new.is_active,
    new.raw_payload, new.synced_at, new.flash_company_id, new.company_key, new.company_name, new.company_cnpj
  from auth.users u
  where u.id <> new.user_id
  on conflict (user_id, flash_company_id, flash_department_id)
  do update set
    name = excluded.name,
    description = excluded.description,
    external_id = excluded.external_id,
    is_active = excluded.is_active,
    raw_payload = excluded.raw_payload,
    synced_at = excluded.synced_at,
    company_key = excluded.company_key,
    company_name = excluded.company_name,
    company_cnpj = excluded.company_cnpj;

  return new;
end;
$$;

create or replace function public.propagate_flash_schedule_to_all_users()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    delete from public.employee_schedule_allocations
    where user_id <> old.user_id
      and source_key = old.source_key;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.source_key is distinct from new.source_key then
    delete from public.employee_schedule_allocations
    where user_id <> old.user_id
      and source_key = old.source_key;
  end if;

  insert into public.employee_schedule_allocations (
    user_id, source_key, flash_employee_id, external_id, employee_name,
    timetable_id, timetable_name, allocation_id, allocation_start_date,
    scheduled_entry, break_start, break_end, scheduled_exit, schedule_times,
    raw_payload, synced_at, flash_company_id, company_key, company_name, company_cnpj
  )
  select
    u.id, new.source_key, new.flash_employee_id, new.external_id, new.employee_name,
    new.timetable_id, new.timetable_name, new.allocation_id, new.allocation_start_date,
    new.scheduled_entry, new.break_start, new.break_end, new.scheduled_exit, new.schedule_times,
    new.raw_payload, new.synced_at, new.flash_company_id, new.company_key, new.company_name, new.company_cnpj
  from auth.users u
  where u.id <> new.user_id
  on conflict (user_id, source_key)
  do update set
    flash_employee_id = excluded.flash_employee_id,
    external_id = excluded.external_id,
    employee_name = excluded.employee_name,
    timetable_id = excluded.timetable_id,
    timetable_name = excluded.timetable_name,
    allocation_id = excluded.allocation_id,
    allocation_start_date = excluded.allocation_start_date,
    scheduled_entry = excluded.scheduled_entry,
    break_start = excluded.break_start,
    break_end = excluded.break_end,
    scheduled_exit = excluded.scheduled_exit,
    schedule_times = excluded.schedule_times,
    raw_payload = excluded.raw_payload,
    synced_at = excluded.synced_at,
    flash_company_id = excluded.flash_company_id,
    company_key = excluded.company_key,
    company_name = excluded.company_name,
    company_cnpj = excluded.company_cnpj;

  return new;
end;
$$;

create or replace function public.propagate_completed_flash_structure_run()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  original_run_id uuid;
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  if new.source_run_id is not null then return new; end if;

  original_run_id := new.id;

  insert into public.flash_structure_sync_runs (
    id, user_id, status, employees_processed, departments_processed,
    allocations_processed, warning_count, error_message, started_at, finished_at,
    companies_processed, companies_total, current_company_index,
    current_company_name, current_stage, current_company_employees_total,
    current_company_employees_processed, progress_updated_at, flash_company_id,
    company_key, company_name, company_cnpj, sync_target, source_run_id
  )
  select
    gen_random_uuid(), u.id, new.status, new.employees_processed, new.departments_processed,
    new.allocations_processed, new.warning_count, new.error_message, new.started_at, new.finished_at,
    new.companies_processed, new.companies_total, new.current_company_index,
    new.current_company_name, new.current_stage, new.current_company_employees_total,
    new.current_company_employees_processed, new.progress_updated_at, new.flash_company_id,
    new.company_key, new.company_name, new.company_cnpj, new.sync_target, original_run_id
  from auth.users u
  where u.id <> new.user_id
  on conflict (user_id, source_run_id)
  do update set
    status = excluded.status,
    employees_processed = excluded.employees_processed,
    departments_processed = excluded.departments_processed,
    allocations_processed = excluded.allocations_processed,
    warning_count = excluded.warning_count,
    error_message = excluded.error_message,
    started_at = excluded.started_at,
    finished_at = excluded.finished_at,
    companies_processed = excluded.companies_processed,
    companies_total = excluded.companies_total,
    current_company_index = excluded.current_company_index,
    current_company_name = excluded.current_company_name,
    current_stage = excluded.current_stage,
    current_company_employees_total = excluded.current_company_employees_total,
    current_company_employees_processed = excluded.current_company_employees_processed,
    progress_updated_at = excluded.progress_updated_at,
    flash_company_id = excluded.flash_company_id,
    company_key = excluded.company_key,
    company_name = excluded.company_name,
    company_cnpj = excluded.company_cnpj,
    sync_target = excluded.sync_target;

  return new;
end;
$$;

drop trigger if exists share_flash_employees_with_all_users on public.flash_employees;
create trigger share_flash_employees_with_all_users
  after insert or update or delete on public.flash_employees
  for each row execute function public.propagate_flash_employee_to_all_users();

drop trigger if exists share_flash_departments_with_all_users on public.flash_departments;
create trigger share_flash_departments_with_all_users
  after insert or update or delete on public.flash_departments
  for each row execute function public.propagate_flash_department_to_all_users();

drop trigger if exists share_flash_schedules_with_all_users on public.employee_schedule_allocations;
create trigger share_flash_schedules_with_all_users
  after insert or update or delete on public.employee_schedule_allocations
  for each row execute function public.propagate_flash_schedule_to_all_users();

drop trigger if exists share_completed_flash_structure_run on public.flash_structure_sync_runs;
create trigger share_completed_flash_structure_run
  after update of status on public.flash_structure_sync_runs
  for each row execute function public.propagate_completed_flash_structure_run();

-- ---------------------------------------------------------------------------
-- 4. Novas contas já nascem com a estrutura Flash atual.
-- ---------------------------------------------------------------------------
create or replace function public.copy_flash_structure_to_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.flash_employees (
    user_id, flash_employee_id, external_id, employee_name, status,
    flash_department_id, department_name, raw_payload, synced_at,
    flash_company_id, company_key, company_name, company_cnpj
  )
  select
    new.id, src.flash_employee_id, src.external_id, src.employee_name, src.status,
    src.flash_department_id, src.department_name, src.raw_payload, src.synced_at,
    src.flash_company_id, src.company_key, src.company_name, src.company_cnpj
  from (
    select distinct on (flash_company_id, flash_employee_id) *
    from public.flash_employees
    where user_id <> new.id and flash_company_id is not null
    order by flash_company_id, flash_employee_id, synced_at desc, id desc
  ) src
  on conflict (user_id, flash_company_id, flash_employee_id) do nothing;

  insert into public.flash_departments (
    user_id, flash_department_id, name, description, external_id, is_active,
    raw_payload, synced_at, flash_company_id, company_key, company_name, company_cnpj
  )
  select
    new.id, src.flash_department_id, src.name, src.description, src.external_id, src.is_active,
    src.raw_payload, src.synced_at, src.flash_company_id, src.company_key, src.company_name, src.company_cnpj
  from (
    select distinct on (flash_company_id, flash_department_id) *
    from public.flash_departments
    where user_id <> new.id and flash_company_id is not null
    order by flash_company_id, flash_department_id, synced_at desc, id desc
  ) src
  on conflict (user_id, flash_company_id, flash_department_id) do nothing;

  insert into public.employee_schedule_allocations (
    user_id, source_key, flash_employee_id, external_id, employee_name,
    timetable_id, timetable_name, allocation_id, allocation_start_date,
    scheduled_entry, break_start, break_end, scheduled_exit, schedule_times,
    raw_payload, synced_at, flash_company_id, company_key, company_name, company_cnpj
  )
  select
    new.id, src.source_key, src.flash_employee_id, src.external_id, src.employee_name,
    src.timetable_id, src.timetable_name, src.allocation_id, src.allocation_start_date,
    src.scheduled_entry, src.break_start, src.break_end, src.scheduled_exit, src.schedule_times,
    src.raw_payload, src.synced_at, src.flash_company_id, src.company_key, src.company_name, src.company_cnpj
  from (
    select distinct on (source_key) *
    from public.employee_schedule_allocations
    where user_id <> new.id
    order by source_key, synced_at desc, id desc
  ) src
  on conflict (user_id, source_key) do nothing;

  insert into public.flash_structure_sync_runs (
    id, user_id, status, employees_processed, departments_processed,
    allocations_processed, warning_count, error_message, started_at, finished_at,
    companies_processed, companies_total, current_company_index,
    current_company_name, current_stage, current_company_employees_total,
    current_company_employees_processed, progress_updated_at, flash_company_id,
    company_key, company_name, company_cnpj, sync_target, source_run_id
  )
  select
    gen_random_uuid(), new.id, src.status, src.employees_processed, src.departments_processed,
    src.allocations_processed, src.warning_count, src.error_message, src.started_at, src.finished_at,
    src.companies_processed, src.companies_total, src.current_company_index,
    src.current_company_name, src.current_stage, src.current_company_employees_total,
    src.current_company_employees_processed, src.progress_updated_at, src.flash_company_id,
    src.company_key, src.company_name, src.company_cnpj, src.sync_target, src.id
  from (
    select distinct on (company_key, sync_target) *
    from public.flash_structure_sync_runs
    where user_id <> new.id
      and status = 'completed'
      and source_run_id is null
      and company_key is not null
      and sync_target is not null
    order by company_key, sync_target, finished_at desc nulls last, started_at desc
  ) src
  on conflict (user_id, source_run_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_copy_flash_structure on auth.users;
create trigger on_auth_user_created_copy_flash_structure
  after insert on auth.users
  for each row execute function public.copy_flash_structure_to_new_user();

comment on function public.copy_flash_structure_to_new_user() is
  'Copia a estrutura Flash global para cada nova conta criada no sistema.';
