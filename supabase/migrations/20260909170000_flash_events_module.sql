-- Módulo Eventos: persiste eventos retornados pela API de Controle de Jornada da Flash.
-- CID é dado sensível e fica protegido pelas mesmas regras RLS por usuário do restante do sistema.

create table if not exists public.flash_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  import_run_id uuid not null,
  flash_event_id bigint not null,
  flash_company_id text not null,
  company_key text not null,
  company_name text not null,
  company_cnpj text,
  flash_employee_id text,
  external_id text,
  employee_name text not null,
  department text,
  reason_id bigint,
  reason_api_id text,
  reason_name text,
  reason_description text,
  period_type text,
  event_date date not null,
  start_at timestamp without time zone,
  end_at timestamp without time zone,
  duration_minutes integer,
  quantity_label text,
  justification text,
  cids text[] not null default '{}',
  approval_type text,
  status text,
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique (user_id, flash_company_id, flash_event_id)
);

create index if not exists flash_events_user_date_idx
  on public.flash_events (user_id, event_date desc);
create index if not exists flash_events_user_company_date_idx
  on public.flash_events (user_id, company_name, event_date desc);
create index if not exists flash_events_user_employee_date_idx
  on public.flash_events (user_id, employee_name, event_date desc);
create index if not exists flash_events_user_department_date_idx
  on public.flash_events (user_id, department, event_date desc);
create index if not exists flash_events_user_reason_date_idx
  on public.flash_events (user_id, reason_name, event_date desc);

alter table public.flash_events enable row level security;

drop policy if exists "Users can read own flash events" on public.flash_events;
create policy "Users can read own flash events"
  on public.flash_events for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own flash events" on public.flash_events;
create policy "Users can insert own flash events"
  on public.flash_events for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own flash events" on public.flash_events;
create policy "Users can update own flash events"
  on public.flash_events for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own flash events" on public.flash_events;
create policy "Users can delete own flash events"
  on public.flash_events for delete
  to authenticated
  using (auth.uid() = user_id);

comment on table public.flash_events is 'Eventos mensais da Flash enriquecidos com colaborador, departamento, filial e catálogo de motivos.';
comment on column public.flash_events.cids is 'CIDs retornados pela Flash; dado sensível protegido por RLS.';
comment on column public.flash_events.reason_description is 'Descrição do motivo validada contra relatório do portal Flash quando disponível.';
