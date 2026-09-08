-- Sincronização granular da estrutura Flash por empresa e por recurso.
-- Cada execução passa a representar somente funcionários, departamentos/cargos ou horários de uma empresa.

alter table public.flash_structure_sync_runs
  add column if not exists flash_company_id text,
  add column if not exists company_key text,
  add column if not exists company_name text,
  add column if not exists company_cnpj text,
  add column if not exists sync_target text;

create index if not exists flash_structure_sync_company_target_idx
  on public.flash_structure_sync_runs (user_id, company_key, sync_target, started_at desc);

comment on column public.flash_structure_sync_runs.sync_target is 'Recurso sincronizado: employees, departments ou schedules.';
comment on column public.flash_structure_sync_runs.company_key is 'Chave estável da empresa configurada no backend.';
