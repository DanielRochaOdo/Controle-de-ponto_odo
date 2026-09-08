-- Progresso observável da sincronização cadastral da Flash.
-- Permite que a tela de Configurações acompanhe a execução enquanto o POST ainda está ativo.

alter table public.flash_structure_sync_runs
  add column if not exists companies_total integer not null default 0,
  add column if not exists current_company_index integer not null default 0,
  add column if not exists current_company_name text,
  add column if not exists current_stage text,
  add column if not exists current_company_employees_total integer not null default 0,
  add column if not exists current_company_employees_processed integer not null default 0,
  add column if not exists progress_updated_at timestamptz;

create index if not exists flash_structure_sync_runs_user_status_started_idx
  on public.flash_structure_sync_runs (user_id, status, started_at desc);

comment on column public.flash_structure_sync_runs.companies_total is 'Quantidade total de empresas previstas nesta sincronização.';
comment on column public.flash_structure_sync_runs.current_company_index is 'Posição 1-based da empresa atualmente processada.';
comment on column public.flash_structure_sync_runs.current_company_name is 'Empresa atualmente processada.';
comment on column public.flash_structure_sync_runs.current_stage is 'Etapa atual da sincronização exibida ao usuário.';
comment on column public.flash_structure_sync_runs.current_company_employees_total is 'Total de colaboradores da empresa atual cuja escala será consultada.';
comment on column public.flash_structure_sync_runs.current_company_employees_processed is 'Colaboradores da empresa atual cuja consulta de escala já terminou.';
comment on column public.flash_structure_sync_runs.progress_updated_at is 'Último instante em que o backend registrou avanço da sincronização.';
