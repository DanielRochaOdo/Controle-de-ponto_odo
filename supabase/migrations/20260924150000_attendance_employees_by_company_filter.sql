-- Mantém o contrato existente e acrescenta a relação de colaboradores por empresa
-- para que o frontend não precise consultar novamente a API ao trocar o filtro.
-- Usa o mesmo predicado de escopo do manager aplicado nas demais listas.
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
    'employeesByCompany', coalesce((
      select jsonb_object_agg(company_name, employees)
      from (
        select company_name, jsonb_agg(employee_name order by employee_name) as employees
        from (
          select distinct company_name, employee_name
          from public.attendance_days
          where user_id = p_user_id
            and company_name is not null
            and employee_name is not null
            and public.can_view_attendance_scope(user_id, flash_company_id, department)
        ) distinct_employees
        group by company_name
      ) per_company
    ), '{}'::jsonb),
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
