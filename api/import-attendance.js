import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  dateRange,
  listAttendanceDay,
  listEmployees,
  listTimetableAllocations,
  normalizeAttendanceDay,
} from './_lib/flash.js';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });

  const { startDate, endDate } = req.body || {};
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    return res.status(400).json({ error: 'Período inválido.' });
  }

  const days = dateRange(startDate, endDate);
  if (days.length === 0 || days.length > 62) {
    return res.status(400).json({ error: 'Selecione um período de até 62 dias.' });
  }

  const companyId = process.env.FLASH_COMPANY_ID;
  if (!companyId) return res.status(500).json({ stage: 'configuração', error: 'FLASH_COMPANY_ID não configurado.' });
  if (!process.env.FLASH_API_KEY) return res.status(500).json({ stage: 'configuração', error: 'FLASH_API_KEY não configurada.' });

  let runId = null;
  let supabase = null;
  let stage = 'configuração do backend';

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
      end_date: endDate,
      status: 'running',
      started_at: new Date().toISOString(),
    });
    if (runError) throw runError;

    stage = 'consulta de colaboradores e escalas na Flash';
    const [{ data: settingsRow, error: settingsError }, employees, allocations] = await Promise.all([
      supabase.from('attendance_settings').select('*').eq('user_id', userId).maybeSingle(),
      listEmployees(companyId),
      listTimetableAllocations(companyId, startDate, endDate),
    ]);
    if (settingsError) throw settingsError;
    const settings = { ...defaultSettings, ...(settingsRow || {}) };

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
      .lte('work_date', endDate)
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
      endDate,
      employeesProcessed: employees.length,
      recordsProcessed: rows.length,
      finishedAt,
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
