import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getConfiguredFlashCompanies, getMissingFlashCompanies } from './_lib/flashCompanies.js';

const FLASH_ATTENDANCE_BASE_URL = 'https://api.flashapp.services/time-and-attendance/v1/';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Fortaleza';
const EVENTS_START_MONTH = '2026-01';

// A API pública de Controle de Jornada expõe reasonId/reasonApiId, mas não documenta
// um endpoint GET para o catálogo dos motivos. Estes valores foram validados cruzando
// a resposta real de /events com o relatório oficial de Eventos exportado pelo portal Flash.
const EVENT_REASON_CATALOG = new Map([
  [163317, { name: 'Atestado Médico', description: '' }],
  [163335, { name: 'Falta injustificada', description: 'As horas lançadas vão para Descontar Salário – Desconto Simples (1002)' }],
  [163328, { name: 'Folgas abonadas pelo gestor', description: '' }],
  [163322, { name: 'Casamento', description: 'A licença gala ou licença casamento é um benefício garante 3 dias consecutivos de licença. Esses dias de folga são contados a partir do primeiro dia após a realização da cerimônia.' }],
  [218926, { name: 'Atraso', description: '' }],
  [213801, { name: 'Atraso justificado CCT', description: '' }],
  [163332, { name: 'Declaração de Horas', description: '' }],
]);

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

const currentMonthInAppTimezone = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
};

const validMonth = (value) => /^\d{4}-\d{2}$/.test(value || '') && Number(value.slice(5, 7)) >= 1 && Number(value.slice(5, 7)) <= 12;

async function listEvents(companyId, year, month) {
  const apiKey = process.env.FLASH_API_KEY;
  if (!apiKey) throw new Error('FLASH_API_KEY não configurada.');

  const url = new URL('events', FLASH_ATTENDANCE_BASE_URL);
  url.searchParams.set('year', String(year));
  url.searchParams.set('month', String(Number(month)));
  url.searchParams.set('companyId', String(companyId));

  const response = await fetch(url, {
    headers: {
      'x-flash-auth': apiKey,
      Accept: 'application/json',
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.success === false) {
    const error = new Error(payload?.message || `Flash API respondeu ${response.status}`);
    error.status = response.status;
    error.endpoint = `${url.origin}${url.pathname}`;
    error.requestId = payload?.request_id || payload?.requestId || null;
    throw error;
  }

  return Array.isArray(payload?.data) ? payload.data : [];
}

async function fetchAllEmployees(supabase, userId) {
  const result = [];
  const batchSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('flash_employees')
      .select('flash_company_id,flash_employee_id,external_id,employee_name,department_name')
      .eq('user_id', userId)
      .range(offset, offset + batchSize - 1);
    if (error) throw error;
    const batch = data || [];
    result.push(...batch);
    if (batch.length < batchSize) break;
    offset += batchSize;
  }

  return result;
}

const employeeMapsForCompany = (employees, companyId) => {
  const byId = new Map();
  const byExternalId = new Map();
  employees
    .filter((employee) => employee.flash_company_id === companyId)
    .forEach((employee) => {
      if (employee.flash_employee_id) byId.set(String(employee.flash_employee_id), employee);
      if (employee.external_id) byExternalId.set(String(employee.external_id), employee);
    });
  return { byId, byExternalId };
};

const calendarDaysInclusive = (startDate, endDate) => {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  return Math.floor((end - start) / 86400000) + 1;
};

const formatDuration = (minutes) => {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total < 0) return null;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
};

const quantityLabel = (event) => {
  const type = String(event?.periodType || '').toUpperCase();
  if (type === 'ALL_DAY') return 'Dia Todo';
  if (type === 'HOURS') return formatDuration(event?.duration) || '—';
  if (type === 'PERIOD') {
    const start = String(event?.startDate || '').slice(0, 10);
    const end = String(event?.endDate || '').slice(0, 10);
    const days = calendarDaysInclusive(start, end);
    if (!days) return 'Período';
    return `${days} ${days === 1 ? 'Dia' : 'Dias'}`;
  }
  return event?.periodType || '—';
};

const normalizeEvent = ({ event, company, employee, userId, runId, importedAt }) => {
  const reasonId = Number.isFinite(Number(event?.reasonId)) ? Number(event.reasonId) : null;
  const reason = reasonId ? EVENT_REASON_CATALOG.get(reasonId) : null;
  const employeeId = String(event?.employeeId || employee?.flash_employee_id || '');
  const externalId = String(event?.externalId || employee?.external_id || '');
  const startDate = String(event?.startDate || '').slice(0, 10);

  return {
    user_id: userId,
    import_run_id: runId,
    flash_event_id: Number(event.id),
    flash_company_id: company.id,
    company_key: company.key,
    company_name: company.name,
    company_cnpj: company.cnpj,
    flash_employee_id: employeeId || null,
    external_id: externalId || null,
    employee_name: employee?.employee_name || `Colaborador ${externalId || employeeId || event.id}`,
    department: employee?.department_name || null,
    reason_id: reasonId,
    reason_api_id: event?.reasonApiId || null,
    reason_name: reason?.name || (reasonId ? `Motivo #${reasonId}` : 'Motivo não informado'),
    reason_description: reason?.description || null,
    period_type: event?.periodType || null,
    event_date: startDate,
    start_at: event?.startDate || null,
    end_at: event?.endDate || null,
    duration_minutes: Number.isFinite(Number(event?.duration)) ? Number(event.duration) : null,
    quantity_label: quantityLabel(event),
    justification: event?.justification || null,
    cids: Array.isArray(event?.cids) ? event.cids.filter(Boolean).map(String) : [],
    approval_type: event?.approvalType || null,
    status: event?.status || null,
    raw_payload: event,
    imported_at: importedAt,
  };
};

async function upsertChunks(supabase, rows, size = 500) {
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    if (!chunk.length) continue;
    const { error } = await supabase
      .from('flash_events')
      .upsert(chunk, { onConflict: 'user_id,flash_company_id,flash_event_id' });
    if (error) throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  if (!process.env.FLASH_API_KEY) return res.status(500).json({ stage: 'configuração', error: 'FLASH_API_KEY não configurada.' });

  const { month } = req.body || {};
  if (!validMonth(month)) return res.status(400).json({ error: 'Competência inválida.' });
  if (month < EVENTS_START_MONTH) return res.status(400).json({ error: 'O módulo de eventos considera competências a partir de janeiro/2026.' });

  const currentMonth = currentMonthInAppTimezone();
  if (month > currentMonth) return res.status(400).json({ error: 'Não é possível importar eventos de uma competência futura.' });

  const missingCompanies = getMissingFlashCompanies();
  if (missingCompanies.length) {
    return res.status(500).json({
      stage: 'configuração das empresas',
      error: `Faltam Company IDs da Flash no .env: ${missingCompanies.map((company) => company.env).join(', ')}`,
    });
  }

  let stage = 'configuração do backend';
  try {
    const supabase = getServerClient();
    stage = 'autenticação da sessão';
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) return res.status(401).json({ stage, error: 'Sessão inválida ou expirada.' });
    const userId = authData.user.id;

    stage = 'carregamento dos funcionários sincronizados';
    const employees = await fetchAllEmployees(supabase, userId);
    const companies = getConfiguredFlashCompanies();
    const [year, monthNumber] = month.split('-').map(Number);
    const runId = crypto.randomUUID();
    const importedAt = new Date().toISOString();
    const rows = [];
    const warnings = [];
    const companyResults = [];
    const unknownReasonIds = new Set();

    for (const company of companies) {
      stage = `consulta dos eventos - ${company.name}`;
      const events = await listEvents(company.id, year, monthNumber);
      const employeeMaps = employeeMapsForCompany(employees, company.id);
      let unresolvedEmployees = 0;

      events.forEach((event) => {
        if (event?.id === undefined || event?.id === null || !event?.startDate) return;
        const employeeId = String(event?.employeeId || '');
        const externalId = String(event?.externalId || '');
        const employee = employeeMaps.byId.get(employeeId) || employeeMaps.byExternalId.get(externalId) || null;
        if (!employee) unresolvedEmployees += 1;

        const normalized = normalizeEvent({ event, company, employee, userId, runId, importedAt });
        if (normalized.reason_id && !EVENT_REASON_CATALOG.has(normalized.reason_id)) unknownReasonIds.add(normalized.reason_id);
        rows.push(normalized);
      });

      if (unresolvedEmployees) {
        warnings.push(`${company.name}: ${unresolvedEmployees} evento(s) sem colaborador correspondente na estrutura sincronizada.`);
      }
      companyResults.push({ companyKey: company.key, companyName: company.name, eventsProcessed: events.length, unresolvedEmployees });
    }

    stage = 'gravação dos eventos no Supabase';
    await upsertChunks(supabase, rows);

    stage = 'limpeza dos eventos antigos da competência';
    const startDate = `${month}-01`;
    const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1, 12));
    const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const { error: cleanupError } = await supabase
      .from('flash_events')
      .delete()
      .eq('user_id', userId)
      .gte('event_date', startDate)
      .lt('event_date', nextMonth)
      .neq('import_run_id', runId);
    if (cleanupError) throw cleanupError;

    return res.status(200).json({
      success: true,
      month,
      companiesProcessed: companies.length,
      eventsProcessed: rows.length,
      unknownReasonIds: [...unknownReasonIds].sort((a, b) => a - b),
      warnings,
      companies: companyResults,
      finishedAt: importedAt,
    });
  } catch (error) {
    console.error(`Falha na importação de eventos Flash [${stage}]:`, error);
    return res.status(500).json({
      stage,
      error: error?.message || 'Falha ao importar eventos da Flash.',
      flashStatus: error?.status || null,
      flashEndpoint: error?.endpoint || null,
      flashRequestId: error?.requestId || null,
    });
  }
}
