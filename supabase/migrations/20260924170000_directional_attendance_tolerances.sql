-- Regras direcionais: No horário é o resultado de estar dentro das tolerâncias,
-- não uma janela independente que disputa prioridade com os demais status.
-- Entrada: antes = early.before; depois = late.after.
-- Saída: antes = early.before; depois = late_exit.after.
-- 'adjusted' informado pela Flash mantém prioridade, sem tolerância própria.
-- Mantemos a assinatura da função para compatibilidade com trigger/recalculate existentes;
-- p_on_time_tolerance permanece apenas como argumento legado.
create or replace function public.classify_attendance_mark(
  p_expected time,
  p_actual time,
  p_current_status text,
  p_is_exit boolean,
  p_status_tolerances jsonb,
  p_on_time_tolerance integer,
  p_late_tolerance integer,
  p_late_exit_tolerance integer,
  p_early_tolerance integer
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  diff_seconds numeric;
  early_minutes integer;
  after_minutes integer;
begin
  if p_current_status = 'adjusted' then
    return 'adjusted';
  end if;

  if p_expected is null or p_actual is null then
    return null;
  end if;

  early_minutes := greatest(0, least(60,
    coalesce(nullif(p_status_tolerances #>> '{early,before}', '')::integer, p_early_tolerance, 5)
  ));
  if p_is_exit then
    after_minutes := greatest(0, least(60,
      coalesce(nullif(p_status_tolerances #>> '{late_exit,after}', '')::integer, p_late_exit_tolerance, 5)
    ));
  else
    after_minutes := greatest(0, least(60,
      coalesce(nullif(p_status_tolerances #>> '{late,after}', '')::integer, p_late_tolerance, 5)
    ));
  end if;

  diff_seconds := extract(epoch from (p_actual - p_expected));

  -- Antes: -5min exatos ainda são tolerados; -5min01s é antecipado.
  if diff_seconds < -(early_minutes * 60) then
    return 'early';
  end if;

  -- Depois: cinco minutos incluem o minuto completo até HH:05:59.
  -- Ex.: saída prevista 18:00 / real 18:01 => No horário com 5 minutos.
  if diff_seconds >= ((after_minutes + 1) * 60) then
    return case when p_is_exit then 'late_exit' else 'late' end;
  end if;

  return 'on_time';
end;
$$;

comment on function public.classify_attendance_mark(
  time, time, text, boolean, jsonb, integer, integer, integer, integer
) is 'Classificação direcional: tolerância antes de early, depois de late/late_exit. Dentro da faixa: on_time. adjusted tem prioridade.';

comment on column public.attendance_settings.status_tolerances is
  'Tolerâncias direcionais em minutos: early.before, late.after, late_exit.after. Chaves on_time e adjusted existentes são legado e não determinam classificação.';

-- Recalcula todas as linhas históricas, inclusive de managers, a partir das
-- configurações DO PROPRIETÁRIO de cada registro. Não muda batidas ou escalas.
-- A trigger existente continua chamando a mesma função corrigida em updates e imports.
update public.attendance_days as a
set entry_status = public.classify_attendance_mark(
      a.scheduled_entry, a.actual_entry, a.entry_status, false,
      coalesce(s.status_tolerances, '{}'::jsonb),
      coalesce(s.on_time_tolerance, 5),
      coalesce(s.late_tolerance, 5),
      coalesce(s.late_exit_tolerance, 5),
      coalesce(s.early_tolerance, 5)
    ),
    exit_status = public.classify_attendance_mark(
      a.scheduled_exit, a.actual_exit, a.exit_status, true,
      coalesce(s.status_tolerances, '{}'::jsonb),
      coalesce(s.on_time_tolerance, 5),
      coalesce(s.late_tolerance, 5),
      coalesce(s.late_exit_tolerance, 5),
      coalesce(s.early_tolerance, 5)
    )
from auth.users as u
left join public.attendance_settings as s on s.user_id = u.id
where a.user_id = u.id
  and (
    a.entry_status is distinct from public.classify_attendance_mark(
      a.scheduled_entry, a.actual_entry, a.entry_status, false,
      coalesce(s.status_tolerances, '{}'::jsonb),
      coalesce(s.on_time_tolerance, 5),
      coalesce(s.late_tolerance, 5),
      coalesce(s.late_exit_tolerance, 5),
      coalesce(s.early_tolerance, 5)
    )
    or a.exit_status is distinct from public.classify_attendance_mark(
      a.scheduled_exit, a.actual_exit, a.exit_status, true,
      coalesce(s.status_tolerances, '{}'::jsonb),
      coalesce(s.on_time_tolerance, 5),
      coalesce(s.late_tolerance, 5),
      coalesce(s.late_exit_tolerance, 5),
      coalesce(s.early_tolerance, 5)
    )
  );
