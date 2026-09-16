-- Controle simples de acesso por role.
-- Perfis existentes preservam o acesso atual como admin.
-- Novos usuários passam a ser criados como manager por padrão.

alter table public.user_profiles
  add column if not exists role text;

update public.user_profiles
set role = 'admin'
where role is null;

insert into public.user_profiles (user_id, display_name, role)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Usuário'
  ),
  'admin'
from auth.users u
where not exists (
  select 1
  from public.user_profiles p
  where p.user_id = u.id
);

alter table public.user_profiles
  alter column role set default 'manager';

alter table public.user_profiles
  alter column role set not null;

do $$
begin
  alter table public.user_profiles
    add constraint user_profiles_role_check
    check (role in ('admin', 'manager'));
exception when duplicate_object then null;
end $$;

comment on column public.user_profiles.role is 'Role do usuário no Controle de Ponto: admin ou manager.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where user_id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Configurações continuam legíveis para o próprio usuário porque Dashboard usa as cores,
-- mas somente admin pode inserir ou alterar configurações.
drop policy if exists "attendance_settings_insert_own" on public.attendance_settings;
create policy "attendance_settings_insert_admin"
  on public.attendance_settings
  for insert
  to authenticated
  with check (auth.uid() = user_id and public.is_admin());

drop policy if exists "attendance_settings_update_own" on public.attendance_settings;
create policy "attendance_settings_update_admin"
  on public.attendance_settings
  for update
  to authenticated
  using (auth.uid() = user_id and public.is_admin())
  with check (auth.uid() = user_id and public.is_admin());

-- Eventos são um módulo exclusivo de admin, inclusive em acesso direto ao Supabase.
drop policy if exists "Users can read own flash events" on public.flash_events;
drop policy if exists "Users can insert own flash events" on public.flash_events;
drop policy if exists "Users can update own flash events" on public.flash_events;
drop policy if exists "Users can delete own flash events" on public.flash_events;

create policy "Admins can read own flash events"
  on public.flash_events
  for select
  to authenticated
  using (auth.uid() = user_id and public.is_admin());

create policy "Admins can insert own flash events"
  on public.flash_events
  for insert
  to authenticated
  with check (auth.uid() = user_id and public.is_admin());

create policy "Admins can update own flash events"
  on public.flash_events
  for update
  to authenticated
  using (auth.uid() = user_id and public.is_admin())
  with check (auth.uid() = user_id and public.is_admin());

create policy "Admins can delete own flash events"
  on public.flash_events
  for delete
  to authenticated
  using (auth.uid() = user_id and public.is_admin());

-- Garante perfil automático para usuários criados daqui em diante.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, display_name, role)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuário'
    ),
    'manager'
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();
