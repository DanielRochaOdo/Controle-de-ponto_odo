alter table public.flash_structure_sync_settings
  add column if not exists is_enabled boolean not null default false,
  add column if not exists is_running boolean not null default false,
  add column if not exists running_started_at timestamptz,
  add column if not exists last_updated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

insert into public.flash_structure_sync_settings (id)
values (1)
on conflict (id) do nothing;
