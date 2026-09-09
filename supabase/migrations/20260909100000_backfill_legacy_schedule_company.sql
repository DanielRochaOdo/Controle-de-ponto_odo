-- Reassocia alocações de horário criadas antes do suporte multiempresa.
-- No modelo antigo da ODONTOART, employee_schedule_allocations não possuía
-- flash_company_id/company_key/company_name/company_cnpj. A importação
-- multiempresa filtra escalas por empresa, então essas linhas legadas ficavam
-- invisíveis mesmo contendo timetable_name e horários válidos.
--
-- O backfill só ocorre quando o flash_employee_id aponta para exatamente uma
-- empresa nos colaboradores atualmente sincronizados. Vínculos ambíguos são
-- deliberadamente ignorados para evitar atribuir uma escala à empresa errada.

with employee_company_candidates as (
  select
    e.user_id,
    e.flash_employee_id,
    min(e.flash_company_id) as flash_company_id,
    min(e.company_key) as company_key,
    min(e.company_name) as company_name,
    min(e.company_cnpj) as company_cnpj,
    count(distinct e.flash_company_id) as company_count
  from public.flash_employees e
  where e.flash_employee_id is not null
    and e.flash_company_id is not null
  group by e.user_id, e.flash_employee_id
),
resolved as (
  select
    a.id as allocation_row_id,
    c.flash_company_id,
    c.company_key,
    c.company_name,
    c.company_cnpj
  from public.employee_schedule_allocations a
  join employee_company_candidates c
    on c.user_id = a.user_id
   and c.flash_employee_id = a.flash_employee_id
   and c.company_count = 1
  where a.flash_company_id is null
)
update public.employee_schedule_allocations a
set
  flash_company_id = r.flash_company_id,
  company_key = r.company_key,
  company_name = r.company_name,
  company_cnpj = r.company_cnpj
from resolved r
where a.id = r.allocation_row_id;

comment on table public.employee_schedule_allocations is
  'Histórico de alocações de horário da Flash, incluindo compatibilidade com registros legados anteriores ao suporte multiempresa.';
