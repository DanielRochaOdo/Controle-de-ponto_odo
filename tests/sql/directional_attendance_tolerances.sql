-- Ambiente mínimo para validar a migração e a reclassificação histórica em PostgreSQL.
create schema auth;
create table auth.users (id uuid primary key);
create table public.attendance_settings (
  user_id uuid primary key,
  status_tolerances jsonb,
  on_time_tolerance integer,
  late_tolerance integer,
  late_exit_tolerance integer,
  early_tolerance integer
);
create table public.attendance_days (
  id integer primary key,
  user_id uuid not null,
  scheduled_entry time,
  actual_entry time,
  scheduled_exit time,
  actual_exit time,
  entry_status text,
  exit_status text
);
insert into auth.users values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- A tolerância específica da saída é 5, mesmo se a janela antiga de on_time
-- contiver after=0. O legado no horário não pode prevalecer sobre a regra nova.
insert into public.attendance_settings (
  user_id, status_tolerances, on_time_tolerance, late_tolerance,
  late_exit_tolerance, early_tolerance
) values (
 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '{"on_time":{"before":0,"after":0},"early":{"before":5,"after":5},"late":{"before":5,"after":5},"late_exit":{"before":5,"after":5},"adjusted":{"before":0,"after":0}}',
 0, 5, 5, 5
);
insert into public.attendance_days values
 (1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '08:00:00', '08:01:00', '18:00:00', '18:01:00', 'late', 'late_exit'),
 (2, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '08:00:00', '08:06:00', '18:00:00', '18:05:59', 'on_time', 'late_exit'),
 (3, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '08:00:00', '08:05:59', '18:00:00', '18:06:00', 'late', 'on_time'),
 (4, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '08:00:00', '07:54:59', '18:00:00', '17:54:59', 'on_time', 'on_time'),
 (5, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '08:00:00', '08:20:00', '18:00:00', '18:20:00', 'adjusted', 'adjusted'),
 (6, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '08:00:00', '08:01:00', '18:00:00', '18:01:00', 'late', 'late_exit');

\ir ../../supabase/migrations/20260924170000_directional_attendance_tolerances.sql

do $$
declare
  row1 record;
begin
  select * into row1 from public.attendance_days where id = 1;
  if row1.entry_status <> 'on_time' or row1.exit_status <> 'on_time' then
    raise exception '18:01 com tolerância 5 deveria ser on_time: % / %', row1.entry_status, row1.exit_status;
  end if;
  if (select entry_status from public.attendance_days where id = 2) <> 'late' or
     (select exit_status from public.attendance_days where id = 2) <> 'on_time' then
    raise exception 'Limites de 08:06 e 18:05:59 incorretos';
  end if;
  if (select entry_status from public.attendance_days where id = 3) <> 'on_time' or
     (select exit_status from public.attendance_days where id = 3) <> 'late_exit' then
    raise exception 'Limites de 08:05:59 e 18:06 incorretos';
  end if;
  if (select entry_status from public.attendance_days where id = 4) <> 'early' or
     (select exit_status from public.attendance_days where id = 4) <> 'early' then
    raise exception 'Antecipação além de 5 minutos não foi marcada';
  end if;
  if (select entry_status from public.attendance_days where id = 5) <> 'adjusted' or
     (select exit_status from public.attendance_days where id = 5) <> 'adjusted' then
    raise exception 'Ajuste Flash perdeu prioridade';
  end if;
  if (select entry_status from public.attendance_days where id = 6) <> 'on_time' or
     (select exit_status from public.attendance_days where id = 6) <> 'on_time' then
    raise exception 'Conta sem configuração não recebeu tolerância padrão de 5 minutos';
  end if;
end;
$$;

select 'Classificação direcional, migração histórica e limites por segundo OK' as result;
