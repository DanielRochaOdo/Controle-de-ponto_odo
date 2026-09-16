-- Proteção adicional para a estrutura Flash compartilhada.
-- Ao excluir uma conta, os deletes em cascata das cópias pertencentes a ela
-- não podem ser interpretados como exclusão global da estrutura.

create or replace function public.propagate_flash_employee_to_all_users()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Se o usuário já não existe, este DELETE veio do ON DELETE CASCADE de auth.users.
    -- Nesse caso removemos somente a cópia da conta excluída.
    if not exists (select 1 from auth.users where id = old.user_id) then
      return old;
    end if;

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
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from auth.users where id = old.user_id) then
      return old;
    end if;

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
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from auth.users where id = old.user_id) then
      return old;
    end if;

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
