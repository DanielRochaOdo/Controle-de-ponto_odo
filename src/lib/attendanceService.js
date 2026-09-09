import { format } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { FLASH_COMPANY_CATALOG } from '@/lib/flashCompanyCatalog';
import { StatusColors, TimeRecordStatus } from '@/types';

export const STATUS_LABELS = {
  [TimeRecordStatus.ON_TIME]: 'No horário',
  [TimeRecordStatus.LATE]: 'Atraso',
  [TimeRecordStatus.LATE_EXIT]: 'Saída após horário',
  [TimeRecordStatus.EARLY]: 'Antecipado',
  [TimeRecordStatus.ADJUSTED]: 'Ajustado',
};

export const DEFAULT_SETTINGS = {
  tolerances: {
    [TimeRecordStatus.ON_TIME]: 5,
    [TimeRecordStatus.LATE]: 5,
    [TimeRecordStatus.LATE_EXIT]: 5,
    [TimeRecordStatus.EARLY]: 5,
    [TimeRecordStatus.ADJUSTED]: 0,
  },
  colors: { ...StatusColors, [TimeRecordStatus.ADJUSTED]: '#eab308' },
};

const mapSettings = (row) => ({
  tolerances: {
    [TimeRecordStatus.ON_TIME]: row?.on_time_tolerance ?? DEFAULT_SETTINGS.tolerances[TimeRecordStatus.ON_TIME],
    [TimeRecordStatus.LATE]: row?.late_tolerance ?? DEFAULT_SETTINGS.tolerances[TimeRecordStatus.LATE],
    [TimeRecordStatus.LATE_EXIT]: row?.late_exit_tolerance ?? DEFAULT_SETTINGS.tolerances[TimeRecordStatus.LATE_EXIT],
    [TimeRecordStatus.EARLY]: row?.early_tolerance ?? DEFAULT_SETTINGS.tolerances[TimeRecordStatus.EARLY],
    [TimeRecordStatus.ADJUSTED]: row?.adjusted_tolerance ?? DEFAULT_SETTINGS.tolerances[TimeRecordStatus.ADJUSTED],
  },
  colors: { ...DEFAULT_SETTINGS.colors, ...(row?.status_colors || {}) },
  updatedAt: row?.updated_at || null,
});

export async function loadAttendanceSettings(userId) {
  if (!userId) return DEFAULT_SETTINGS;
  const { data, error } = await supabase.from('attendance_settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return mapSettings(data);
}

export async function saveAttendanceSettings(userId, settings) {
  const payload = {
    user_id: userId,
    on_time_tolerance: settings.tolerances[TimeRecordStatus.ON_TIME],
    late_tolerance: settings.tolerances[TimeRecordStatus.LATE],
    late_exit_tolerance: settings.tolerances[TimeRecordStatus.LATE_EXIT],
    early_tolerance: settings.tolerances[TimeRecordStatus.EARLY],
    adjusted_tolerance: settings.tolerances[TimeRecordStatus.ADJUSTED],
    status_colors: settings.colors,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from('attendance_settings').upsert(payload, { onConflict: 'user_id' }).select('*').single();
  if (error) throw error;

  const { error: recalculateError } = await supabase.rpc('recalculate_attendance', { p_user_id: userId });
  if (recalculateError) throw recalculateError;
  return mapSettings(data);
}

function applyFilters(query, userId, filters) {
  let next = query.eq('user_id', userId);
  if (filters.startDate) next = next.gte('work_date', filters.startDate);
  if (filters.endDate) next = next.lte('work_date', filters.endDate);
  if (filters.company && filters.company !== 'all') next = next.eq('company_name', filters.company);
  if (filters.employee && filters.employee !== 'all') next = next.eq('employee_name', filters.employee);
  if (filters.department && filters.department !== 'all') next = next.eq('department', filters.department);
  if (filters.status && filters.status !== 'all') next = next.or(`entry_status.eq.${filters.status},exit_status.eq.${filters.status}`);
  return next;
}

export async function fetchAttendancePage(userId, filters, page = 1, pageSize = 50) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  let query = supabase.from('attendance_days').select('*', { count: 'exact' });
  query = applyFilters(query, userId, filters).order('work_date', { ascending: false }).order('company_name').order('employee_name').range(from, to);
  const { data, error, count } = await query;
  if (error) throw error;
  return { records: data || [], count: count || 0 };
}

export async function fetchAllAttendance(userId, filters) {
  const result = [];
  const batchSize = 1000;
  let offset = 0;

  while (true) {
    let query = supabase.from('attendance_days').select('*');
    query = applyFilters(query, userId, filters)
      .order('work_date', { ascending: false })
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

const uniqueSorted = (values) => [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, 'pt-BR'));

export async function fetchFilterOptions(userId) {
  const { data, error } = await supabase.rpc('get_attendance_filter_options', { p_user_id: userId });
  if (error) throw error;

  const catalogCompanies = FLASH_COMPANY_CATALOG.map((company) => company.name);

  return {
    companies: uniqueSorted([...(data?.companies || []), ...catalogCompanies]),
    employees: uniqueSorted(data?.employees || []),
    departments: uniqueSorted(data?.departments || []),
  };
}

export async function fetchTodayDashboard(userId) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const { data, error } = await supabase.from('attendance_days').select('*').eq('user_id', userId).eq('work_date', today).order('company_name').order('employee_name').limit(1000);
  if (error) throw error;
  return data || [];
}

export async function fetchLatestImport(userId) {
  const { data, error } = await supabase.from('flash_import_runs').select('*').eq('user_id', userId).eq('status', 'completed').order('finished_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function fetchImportHistory(userId, limit = 12) {
  const { data, error } = await supabase
    .from('flash_import_runs')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function fetchStructureSyncRuns(userId, limit = 150) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('flash_structure_sync_runs')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function fetchLatestStructureSyncRun(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('flash_structure_sync_runs')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
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
    const diagnostics = {
      httpStatus: response.status,
      stage: payload.stage || null,
      error: payload.error || null,
      flashStatus: payload.flashStatus || null,
      flashEndpoint: payload.flashEndpoint || null,
      flashRequestId: payload.flashRequestId || null,
    };
    console.error(`[API ${path}] Falha:`, diagnostics);

    const stage = payload.stage ? ` (${payload.stage})` : '';
    const flashStatus = payload.flashStatus ? ` [Flash HTTP ${payload.flashStatus}]` : '';
    const endpoint = payload.flashEndpoint ? ` [${payload.flashEndpoint}]` : '';
    const requestId = payload.flashRequestId ? ` [request_id: ${payload.flashRequestId}]` : '';
    throw new Error(`${payload.error || 'Falha na operação.'}${stage}${flashStatus}${endpoint}${requestId}`);
  }

  return payload;
}

export async function syncFlashStructure(companyKey, target) {
  return authenticatedApiPost('/api/sync-flash-structure', { companyKey, target });
}

export async function importAttendanceFromFlash(startDate, endDate) {
  return authenticatedApiPost('/api/import-attendance', { startDate, endDate });
}
