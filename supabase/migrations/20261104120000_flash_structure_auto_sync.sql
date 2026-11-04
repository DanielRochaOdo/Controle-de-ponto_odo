create table if not exists public.flash_structure_sync_settings (
  id smallint primary key default 1 check (id = 1),
  is_enabled boolean not null default false,
  is_running boolean not null default false,
  running_started_at timestamptz,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.flash_structure_sync_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.flash_structure_sync_settings enable row level security;

comment on table public.flash_structure_sync_settings is
  'Configuração global e estado mínimo da sincronização automática da Estrutura Flash.';
comment on column public.flash_structure_sync_settings.last_updated_at is
  'Última sincronização geral automática concluída com sucesso.';

