-- Perfil mínimo para exibir o nome do usuário no sistema.
-- O cadastro/edição é administrativo e pode ser feito diretamente pelo Supabase.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

do $$
begin
  create policy "user_profiles_select_own"
    on public.user_profiles
    for select
    using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

comment on table public.user_profiles is 'Perfil mínimo do usuário autenticado. O nome é administrado diretamente no Supabase.';
comment on column public.user_profiles.display_name is 'Nome exibido no menu lateral do Controle de Ponto.';

-- Exemplo de cadastro manual após criar o usuário em Authentication > Users:
-- insert into public.user_profiles (user_id, display_name)
-- values ('UUID_DO_USUARIO', 'Nome do usuário');
