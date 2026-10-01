-- Ambiente mínimo para validar tolerâncias direcionais e ausência sem evento.
create role anon;
create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

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
  flash_company_id text,
  flash_employee_id text,
  work_date date,
  scheduled_entry time,
  actual_entry time,
  scheduled_exit time,
  actual_exit time,
  entry_status text,
  exit_status text
);

create table public.flash_employees (
  id serial primary key,
  user_id uuid,
  flash_company_id text,
  flash_employee_id text,
  external_id text
);

create table public.flash_events (
  id serial primary key,
  user_id uuid,
  flash_company_id text,
  flash_employee_id text,
  external_id text,
  event_date date,
  start_at timestamp without time zone,
  end_at timestamp without time zone
);

insert into auth.users values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.attendance_settings (
  user_id, status_tolerances, on_time_tolerance, late_tolerance,
  late_exit_tolerance, early_tolerance
) values (
 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '{"on_time":{"before":0,"after":0},"early":{"before":5,"after":5},"late":{"before":5,"after":5},"late_exit":{"before":5,"after":5},"adjusted":{"before":0,"after":0}}',
 0, 5, 5, 5
);

insert into public.flash_employees(user_id, flash_company_id, flash_employee_id, external_id) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-external', 'mat-10');

insert into public.flash_events(user_id, flash_company_id, flash_employee_id, event_date, start_at, end_at) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-event', '2026-08-21', '2026-08-21 00:00:00', '2026-08-21 23:59:59'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-period', '2026-08-20', '2026-08-20 00:00:00', '2026-08-22 23:59:59');
insert into public.flash_events(user_id, flash_company_id, external_id, event_date, start_at, end_at) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'mat-10', '2026-08-21', '2026-08-21 00:00:00', '2026-08-21 23:59:59');

-- Casos da tolerância direcional e novos casos sem batida.
insert into public.attendance_days values
 (1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-1', '2026-08-21', '08:00:00', '08:01:00', '18:00:00', '18:01:00', 'late', 'late_exit'),
 (2, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-2', '2026-08-21', '08:00:00', '08:06:00', '18:00:00', '18:05:59', 'on_time', 'late_exit'),
 (3, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-3', '2026-08-21', '08:00:00', '08:05:59', '18:00:00', '18:06:00', 'late', 'on_time'),
 (4, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-4', '2026-08-21', '08:00:00', '07:54:59', '18:00:00', '17:54:59', 'on_time', 'on_time'),
 (5, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-5', '2026-08-21', '08:00:00', '08:20:00', '18:00:00', '18:20:00', 'adjusted', 'adjusted'),
 (6, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'company-a', 'emp-6', '2026-08-21', '08:00:00', '08:01:00', '18:00:00', '18:01:00', 'late', 'late_exit'),
 (7, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-no-event', '2026-08-21', '08:00:00', null, '18:00:00', null, null, null),
 (8, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-event', '2026-08-21', '08:00:00', null, '18:00:00', null, null, null),
 (9, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-period', '2026-08-21', '08:00:00', null, '18:00:00', null, null, null),
 (10, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-external', '2026-08-21', '08:00:00', null, '18:00:00', null, null, null),
 (11, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-no-schedule', '2026-08-21', null, null, null, null, null, null),
 (12, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-one-punch', '2026-08-21', '08:00:00', '08:02:00', '18:00:00', null, null, null);

\ir ../../supabase/migrations/20260924170000_directional_attendance_tolerances.sql
\ir ../../supabase/migrations/20261001133000_no_event_attendance_status.sql

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
  if (select entry_status from public.attendance_days where id = 7) <> 'no_event' or
     (select exit_status from public.attendance_days where id = 7) <> 'no_event' then
    raise exception 'Ausência sem evento não recebeu no_event em ambos os status';
  end if;
  if (select entry_status from public.attendance_days where id = 8) is not null or
     (select exit_status from public.attendance_days where id = 8) is not null then
    raise exception 'Evento no mesmo dia deveria impedir no_event';
  end if;
  if (select entry_status from public.attendance_days where id = 9) is not null or
     (select exit_status from public.attendance_days where id = 9) is not null then
    raise exception 'Evento de período cobrindo o dia deveria impedir no_event';
  end if;
  if (select entry_status from public.attendance_days where id = 10) is not null or
     (select exit_status from public.attendance_days where id = 10) is not null then
    raise exception 'Evento por externalId deveria ser associado pelo cadastro Core';
  end if;
  if (select entry_status from public.attendance_days where id = 11) is not null or
     (select exit_status from public.attendance_days where id = 11) is not null then
    raise exception 'Linha sem jornada prevista não deve ser rotulada como ausência';
  end if;
  if (select entry_status from public.attendance_days where id = 12) <> 'on_time' or
     (select exit_status from public.attendance_days where id = 12) is not null then
    raise exception 'Uma única batida não deve receber no_event nos dois status';
  end if;
end;
$$;

-- A sincronização posterior de Eventos deve corrigir o status sem reimportar pontos.
insert into public.flash_events(user_id, flash_company_id, flash_employee_id, event_date, start_at, end_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'company-a', 'emp-no-event', '2026-08-21', '2026-08-21', '2026-08-21 23:59:59');

do $$
begin
  if (select entry_status from public.attendance_days where id = 7) is not null or
     (select exit_status from public.attendance_days where id = 7) is not null then
    raise exception 'Inserir evento deveria remover no_event automaticamente';
  end if;
end;
$$;

delete from public.flash_events
where flash_company_id = 'company-a'
  and flash_employee_id = 'emp-no-event'
  and event_date = '2026-08-21';

do $$
begin
  if (select entry_status from public.attendance_days where id = 7) <> 'no_event' or
     (select exit_status from public.attendance_days where id = 7) <> 'no_event' then
    raise exception 'Remover o único evento deveria restaurar no_event automaticamente';
  end if;
end;
$$;

select 'Tolerâncias direcionais e ausência sem evento OK' as result;
