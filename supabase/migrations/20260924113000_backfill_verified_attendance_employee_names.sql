-- Corrige apenas nomes artificiais antigos com vínculo EXATO já confirmado no Core.
-- Não cria nomes a partir de IDs, não infere pessoa por nome ou matrícula e
-- não toca em registros sem correspondência comprovada.
update public.attendance_days as attendance
set
  employee_name = employee.employee_name,
  department = coalesce(employee.department_name, attendance.department)
from public.flash_employees as employee
where attendance.user_id = employee.user_id
  and attendance.flash_company_id = employee.flash_company_id
  and attendance.flash_employee_id = employee.flash_employee_id
  and attendance.employee_name ~* '^Colaborador[[:space:]]+[^[:space:]]+$'
  and employee.employee_name !~* '^Colaborador[[:space:]]+[^[:space:]]+$'
  and nullif(btrim(employee.employee_name), '') is not null
  and (attendance.employee_name is distinct from employee.employee_name
       or (employee.department_name is not null
           and attendance.department is distinct from employee.department_name));
