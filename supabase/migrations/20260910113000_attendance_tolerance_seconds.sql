-- A tolerância passa a ser uma janela simples antes/depois do horário previsto.
-- Mantemos as colunas existentes para não quebrar dados/configurações já salvos:
-- early_tolerance = minutos antes; late_tolerance = minutos depois.
-- A tolerância posterior considera o minuto inteiro. Ex.: 1 min após 08:00 aceita
-- até 08:01:59 e classifica 08:02:00 em diante como atraso/saída após horário.

create or replace function public.recalculate_attendance(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.attendance_settings%rowtype;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;

  select * into s
  from public.attendance_settings
  where user_id = p_user_id;

  if not found then
    s.early_tolerance := 5;
    s.late_tolerance := 5;
  end if;

  update public.attendance_days
  set entry_status = case
        when entry_status = 'adjusted' then 'adjusted'
        when actual_entry is null or scheduled_entry is null then null
        when extract(epoch from (actual_entry - scheduled_entry)) < -(s.early_tolerance * 60) then 'early'
        when extract(epoch from (actual_entry - scheduled_entry)) >= ((s.late_tolerance + 1) * 60) then 'late'
        else 'on_time'
      end,
      exit_status = case
        when exit_status = 'adjusted' then 'adjusted'
        when actual_exit is null or scheduled_exit is null then null
        when extract(epoch from (actual_exit - scheduled_exit)) < -(s.early_tolerance * 60) then 'early'
        when extract(epoch from (actual_exit - scheduled_exit)) >= ((s.late_tolerance + 1) * 60) then 'late_exit'
        else 'on_time'
      end
  where user_id = p_user_id;
end;
$$;

grant execute on function public.recalculate_attendance(uuid) to authenticated;

comment on function public.recalculate_attendance(uuid) is
  'Recalcula status usando tolerância em minutos antes/depois e precisão de segundos.';
