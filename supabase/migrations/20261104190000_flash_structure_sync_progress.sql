alter table public.flash_structure_sync_settings
  add column if not exists progress_company_name text,
  add column if not exists progress_target text,
  add column if not exists progress_current integer,
  add column if not exists progress_total integer,
  add column if not exists progress_unit text;
