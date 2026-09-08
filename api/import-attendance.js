import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  dateRange,
  listAttendanceDay,
  listEmployees,
  listTimetableAllocations,
  normalizeAttendanceDay,
} from './_lib/flash.js';

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Fortaleza';

const getServerClient = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL/VITE_SUPABASE_URL não configurada no backend.');
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada no backend.');
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
};

const getToken = (req) => {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : null;
};

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

const currentDateInAppTimezone = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return `${year}-${month}-${day}`;
};

const defaultSettings = {
  on_time_tolerance: 5,
  late_tolerance: 5,
  late_exit_tolerance: 5,
  early_tolerance: 5,
  adjusted_tolerance: 0,
};

async function fetchDays(companyId, days) {
  const result = [];
  const concurrency = 5;
  for (let index = 0; index < days.length; index += concurrency) {
    const batch = days.slice(index, index + concurrency);
    const responses = await Promise.all(batch.map(async (day) => ({
      day,
      attendance: await listAttendanceDay(companyId, day),
    })));
    result.push(...responses);
  }
  return result;
}

const isOptionalTimetableError = (error) => (
  Number(error?.status) === 400 && /user not found/i.test(String(error?.message || ''))
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });

  const { startDate, endDate } = req.body || {};
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    return res.status(400).json({ error: 'Período inválido.' });
  }

  const today = currentDateInAppTimezone();
  if (startDate > today) {
    return res.status(400).json({
      stage: 'validação do período',
      error: 'Não é possível importar marcações de um período futuro.',
    });
  }

  const requestedEndDate = endDate;
  const effectiveEndDate = endDate > today ? today : endDate;
  const days = dateRange(startDate, effectiveEndDate);
  if (days.length === 0 || days.length > 62) {
    return res.status(400).json({ error: 'Selecione um período de até 62 dias.' });
  }

  const companyId = process.env.FLASH_COMPANY_ID;
  if (!companyId) return res.status(500).json({ stage: 'configuração', error: 'FLASH_COMPANY_ID não configurado.' });
  if (!process.env.FLASH_API_KEY) return res.status(500).json({ stage: 'configuração', error: 'FLASH_API_KEY não configurada.' });

  let runId = null;
  let supabase = null;
  let stage = 'configuração do backend';
  const warnings = [];

  if (requestedEndDate !== effectiveEndDate) {
    warnings.push({
      code: 'future_days_skipped',
      message: `O período solicitado terminava em ${requestedEndDate}, mas a Flash não permite consultar datas futuras. A importação foi limitada a ${effectiveEndDate}.`,
    });
  }

  try {
    supabase = getServerClient();

    stage = 'autenticação da sessão';
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) return res.status(401).json({ stage, error: 'Sessão inválida ou expirada.' });

    const userId = authData.user.id;
    runId = crypto.randomUUID();

    stage = 'criação do histórico de importação';
    const { error: runError } = await supabase.from('flash_import_runs').insert({
      id: runId,
      user_id: userId,
      start_date: startDate,
      end_date: effectiveEndDate,
      status: 'running',
      started_at: new Date().toISOString(),
    });
    if (runError) throw runError;

    stage = 'consulta de configurações e colaboradores';
    const [{ data: settingsRow, error: settingsError }, employees] = await Promise.all([
      supabase.from('attendance_settings').select('*').eq('user_id', userId).maybeSingle(),
      listEmployees(companyId),
    ]);
    if (settingsError) throw settingsError;
    const settings = { ...defaultSettings, ...(settingsRow || {}) };

    let allocations = [];
    stage = 'consulta de escalas na Flash';
    try {
      allocations = await listTimetableAllocations(companyId, startDate, effectiveEndDate);
    } catch (error) {
      if (!isOptionalTimetableError(error)) throw error;

      warnings.push({
        code: 'timetable_unavailable',
        message: 'A Flash respondeu "User not found" ao consultar alocações de escala sem employeeId. A importação seguirá apenas com as marcações de ponto.',
        flashStatus: error?.status || null,
        flashEndpoint: error?.endpoint || null,
        flashRequestId: error?.requestId || null,
      });
      console.warn('Flash: consulta de escalas ignorada; importação seguirá com attendance/day.', {
        status: error?.status,
        endpoint: error?.endpoint,
        requestId: error?.requestId,
      });
    }

    stage = 'consulta das marcações diárias na Flash';
    const dailyPayloads = await fetchDays(companyId, days);

    stage = 'normalização das marcações';
    const rows = dailyPayloads.flatMap(({ day, attendance }) => normalizeAttendanceDay({
      day,
      attendance,
      employees,
      allocations,
      settings,
      companyId,
      userId,
      importRunId: runId,
    }));

    stage = 'gravação dos registros no Supabase';
    for (let index = 0; index < rows.length; index += 500) {
      const chunk = rows.slice(index, index + 500);
      const { error } = await supabase
        .from('attendance_days')
        .upsert(chunk, { onConflict: 'user_id,source_key' });
      if (error) throw error;
    }

    stage = 'limpeza de registros antigos do período';
    const { error: cleanupError } = await supabase
      .from('attendance_days')
      .delete()
      .eq('user_id', userId)
      .gte('work_date', startDate)
      .lte('work_date', effectiveEndDate)
      .neq('import_run_id', runId);
    if (cleanupError) throw cleanupError;

    stage = 'finalização do histórico de importação';
    const finishedAt = new Date().toISOString();
    const { error: finishError } = await supabase
      .from('flash_import_runs')
      .update({
        status: 'completed',
        finished_at: finishedAt,
        employees_processed: employees.length,
        records_processed: rows.length,
      })
      .eq('id', runId);
    if (finishError) throw finishError;

    return res.status(200).json({
      success: true,
      importRunId: runId,
      startDate,
      endDate: effectiveEndDate,
      requestedEndDate,
      employeesProcessed: employees.length,
      recordsProcessed: rows.length,
      finishedAt,
      warnings,
    });
  } catch (error) {
    console.error(`Falha na importação Flash [${stage}]:`, error);

    if (supabase && runId) {
      await supabase.from('flash_import_runs').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: `[${stage}] ${String(error?.message || error)}`.slice(0, 1000),
      }).eq('id', runId);
    }

    return res.status(500).json({
      stage,
      error: error?.message || 'Falha ao importar dados da Flash.',
      flashStatus: error?.status || null,
      flashEndpoint: error?.endpoint || null,
      flashRequestId: error?.requestId || null,
    });
  }
}
