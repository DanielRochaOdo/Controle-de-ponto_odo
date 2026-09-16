-- Escopo de visualização de registros para managers.
-- Admins continuam vendo todos os próprios registros.
-- Managers podem importar/atualizar toda a base, mas o SELECT de attendance_days
-- é limitado às empresas/departamentos definidos por um admin.

create table if not exists public.manager_attendance_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flash_company_id text not null,
  department_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, flash_company_id, department_key)
);

create index if not exists manager_attendance_permissions_user_company_idx
  on public.manager_attendance_permissions (user_id, flash_company_id);

alter table public.manager_attendance_permissions enable row level security;

-- A tabela é administrada exclusivamente pelo backend com service role.
revoke all on table public.manager_attendance_permissions from anon, authenticated;
grant all on table public.manager_attendance_permissions to service_role;

comment on table public.manager_attendance_permissions is
  'Escopo de registros que cada manager pode visualizar. department_key = * libera toda a empresa; caso contrário contém o flash_department_id.';
comment on column public.manager_attendance_permissions.department_key is
  'Use * para acesso total à empresa ou o flash_department_id para acesso somente ao departamento.';

create or replace function public.can_view_attendance_scope(
  p_user_id uuid,
  p_flash_company_id text,
  p_department text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    auth.uid() is not null
    and auth.uid() = p_user_id
    and (
      exists (
        select 1
        from public.user_profiles profile
        where profile.user_id = p_user_id
          and profile.role = 'admin'
      )
      or exists (
        select 1
        from public.manager_attendance_permissions permission
        where permission.user_id = p_user_id
          and permission.flash_company_id is not distinct from p_flash_company_id
          and (
            permission.department_key = '*'
            or exists (
              select 1
              from public.flash_departments department
              where department.user_id = p_user_id
                and department.flash_company_id is not distinct from p_flash_company_id
                and department.flash_department_id = permission.department_key
                and department.name is not distinct from p_department
            )
          )
      )
    );
$$;

revoke all on function public.can_view_attendance_scope(uuid, text, text) from public;
grant execute on function public.can_view_attendance_scope(uuid, text, text) to authenticated;

-- Substitui a leitura irrestrita dos registros próprios pelo escopo definido acima.
drop policy if exists "attendance_days_select_own" on public.attendance_days;
drop policy if exists "attendance_days_select_scoped" on public.attendance_days;
create policy "attendance_days_select_scoped"
  on public.attendance_days
  for select
  to authenticated
  using (
    auth.uid() = user_id
    and public.can_view_attendance_scope(user_id, flash_company_id, department)
  );

-- A função de filtros era SECURITY DEFINER e, por isso, precisava aplicar o mesmo
-- escopo explicitamente para não expor nomes de colaboradores/departamentos fora
-- da permissão do manager.
create or replace function public.get_attendance_filter_options(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;

  return jsonb_build_object(
    'isAdmin', public.is_admin(),
    'employees', coalesce((
      select jsonb_agg(employee_name order by employee_name)
      from (
        select distinct employee_name
        from public.attendance_days
        where user_id = p_user_id
          and employee_name is not null
          and public.can_view_attendance_scope(user_id, flash_company_id, department)
      ) employees
    ), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(department order by department)
      from (
        select distinct department
        from public.attendance_days
        where user_id = p_user_id
          and department is not null
          and public.can_view_attendance_scope(user_id, flash_company_id, department)
      ) departments
    ), '[]'::jsonb),
    'companies', coalesce((
      select jsonb_agg(company_name order by company_name)
      from (
        select distinct company_name
        from public.attendance_days
        where user_id = p_user_id
          and company_name is not null
          and public.can_view_attendance_scope(user_id, flash_company_id, department)
      ) companies
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_attendance_filter_options(uuid) to authenticated;
