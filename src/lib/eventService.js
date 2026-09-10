import { supabase } from '@/lib/customSupabaseClient';
import { FLASH_COMPANY_CATALOG } from '@/lib/flashCompanyCatalog';

const uniqueSorted = (values) => [...new Set(values
  .filter(Boolean)
  .map((value) => String(value).trim())
  .filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, 'pt-BR'));

function applyFilters(query, userId, filters) {
  let next = query.eq('user_id', userId);
  if (filters.startDate) next = next.gte('event_date', filters.startDate);
  if (filters.endDate) next = next.lte('event_date', filters.endDate);
  if (filters.search) next = next.ilike('employee_name', `%${filters.search}%`);
  if (filters.company && filters.company !== 'all') next = next.eq('company_name', filters.company);
  if (filters.employee && filters.employee !== 'all') next = next.eq('employee_name', filters.employee);
  if (filters.department && filters.department !== 'all') next = next.eq('department', filters.department);
  if (filters.reason && filters.reason !== 'all') next = next.eq('reason_name', filters.reason);
  if (filters.periodType && filters.periodType !== 'all') next = next.eq('period_type', filters.periodType);
  return next;
}

export async function fetchEventsPage(userId, filters, page = 1, pageSize = 10) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  let query = supabase.from('flash_events').select('*', { count: 'exact' });
  query = applyFilters(query, userId, filters)
    .order('event_date', { ascending: false })
    .order('company_name')
    .order('employee_name')
    .range(from, to);
  const { data, error, count } = await query;
  if (error) throw error;
  return { records: data || [], count: count || 0 };
}

export async function fetchAllEvents(userId, filters) {
  const result = [];
  const batchSize = 1000;
  let offset = 0;

  while (true) {
    let query = supabase.from('flash_events').select('*');
    query = applyFilters(query, userId, filters)
      .order('event_date', { ascending: false })
      .order('company_name')
      .order('employee_name')
      .range(offset, offset + batchSize - 1);
    const { data, error } = await query;
    if (error) throw error;
    const batch = data || [];
    result.push(...batch);
    if (batch.length < batchSize) break;
    offset += batchSize;
  }

  return result;
}

export async function fetchEventFilterOptions(userId) {
  const result = [];
  const batchSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('flash_events')
      .select('company_name,employee_name,department,reason_name')
      .eq('user_id', userId)
      .range(offset, offset + batchSize - 1);
    if (error) throw error;
    const batch = data || [];
    result.push(...batch);
    if (batch.length < batchSize) break;
    offset += batchSize;
  }

  return {
    companies: uniqueSorted([
      ...FLASH_COMPANY_CATALOG.map((company) => company.name),
      ...result.map((item) => item.company_name),
    ]),
    employees: uniqueSorted(result.map((item) => item.employee_name)),
    departments: uniqueSorted(result.map((item) => item.department)),
    reasons: uniqueSorted(result.map((item) => item.reason_name)),
  };
}

async function authenticatedApiPost(path, body = {}) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) throw new Error('Sessão expirada. Entre novamente no sistema.');

  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const stage = payload.stage ? ` (${payload.stage})` : '';
    const flashStatus = payload.flashStatus ? ` [Flash HTTP ${payload.flashStatus}]` : '';
    const endpoint = payload.flashEndpoint ? ` [${payload.flashEndpoint}]` : '';
    const requestId = payload.flashRequestId ? ` [request_id: ${payload.flashRequestId}]` : '';
    throw new Error(`${payload.error || 'Falha na operação.'}${stage}${flashStatus}${endpoint}${requestId}`);
  }

  return payload;
}

export async function importEventsFromFlash(month) {
  return authenticatedApiPost('/api/import-events', { month });
}
