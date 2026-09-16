import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  listDepartments,
  listEmployees,
  listTimetableAllocations,
  parseTimetableName,
} from './_lib/flash.js';
import { getFlashCompanies } from './_lib/flashCompanies.js';

const VALID_TARGETS = new Set(['employees', 'departments', 'schedules']);
const FLASH_ATTENDANCE_BASE_URL = 'https://api.flashapp.services/time-and-attendance/v1/';
const SCHEDULE_HISTORY_START = '2026-01-01';

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

const pick = (object, paths) => {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => current?.[key], object);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
};

const dateForTimezone = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
};

const scheduleWindows = () => {
  const timeZone = process.env.APP_TIMEZONE || 'America/Fortaleza';
  const today = dateForTimezone(new Date(), timeZone);
  const currentMonth = today.slice(0, 7);
  const windows = [];
  const cursor = new Date(`${SCHEDULE_HISTORY_START}T12:00:00Z`);

  while (cursor.toISOString().slice(0, 7) <= currentMonth) {
    const year = cursor.getUTCFullYear();
    const monthIndex = cursor.getUTCMonth();
    const month = String(monthIndex + 1).padStart(2, '0');
    const startDate = `${year}-${month}-01`;
    const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 0, 12)).toISOString().slice(0, 10);
    const endDate = startDate.slice(0, 7) === currentMonth ? today : monthEnd;

    windows.push({ month: startDate.slice(0, 7), startDate, endDate });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return windows;
};

const sanitizeEmployee = (employee) => {
  if (!employee || typeof employee !== 'object') return employee;
  const {
    documentNumber,
    pis,
    email,
    corporateEmail,
    phoneNumber,
    profilePicture,
    ...safe
  } = employee;
  return safe;
};

const normalizeDepartmentId = (value) => {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const id = pick(value, ['id', 'departmentId']);
    return id ? String(id) : null;
  }
  return null;
};

const departmentIdsFromEmployee = (employee, companyId) => {
  const result = [];
  const add = (value) => {
    const id = normalizeDepartmentId(value);
    if (id && !result.includes(id)) result.push(id);
  };

  const employments = Array.isArray(employee?.employments) ? employee.employments : [];
  const employment = employments.find((item) => (
    String(item?.companyId || '') === String(companyId)
    && item?.isActive !== false
  ));

  const employmentDepartments = Array.isArray(employment?.departments) ? employment.departments : [];
  employmentDepartments.forEach(add);

  const topLevelDepartments = Array.isArray(employee?.departments) ? employee.departments : [];
  topLevelDepartments.forEach(add);

  const legacyId = pick(employee, ['departmentId']);
  if (legacyId) add(legacyId);

  return result;
};

const firstDepartmentFromEmployee = (employee, departmentsById, companyId) => {
  const departmentIds = departmentIdsFromEmployee(employee, companyId);
  const id = departmentIds[0] || null;
  return {
    id,
    name: id ? departmentsById.get(id) || null : null,
  };
};

const companyFields = (company) => ({
  flash_company_id: company.id,
  company_key: company.key,
  company_name: company.name,
  company_cnpj: company.cnpj,
});

async function upsertChunks(supabase, table, rows, onConflict, size = 500) {
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    if (!chunk.length) continue;
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw error;
  }
}

async function updateRun(supabase, runId, values) {
  const { error } = await supabase
    .from('flash_structure_sync_runs')
    .update({ ...values, progress_updated_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) throw error;
}

async function cleanupStaleRows(supabase, table, userId, companyId, syncedAt) {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('user_id', userId)
    .eq('flash_company_id', companyId)
    .neq('synced_at', syncedAt);
  if (error) throw error;
}

async function loadSyncedDepartmentsMap(supabase, userId, companyId) {
  const { data, error } = await supabase
    .from('flash_departments')
    .select('flash_department_id,name')
    .eq('user_id', userId)
    .eq('flash_company_id', companyId)
    .order('name');
  if (error) throw error;

  return new Map(
    (data || [])
      .filter((department) => department?.flash_department_id && department?.name)
      .map((department) => [String(department.flash_department_id), String(department.name)]),
  );
}

async function backfillEmployeeDepartments(supabase, userId, companyId, departmentsById) {
  let updated = 0;

  for (const [departmentId, departmentName] of departmentsById.entries()) {
    const { data, error } = await supabase
      .from('flash_employees')
      .update({ department_name: departmentName })
      .eq('user_id', userId)
      .eq('flash_company_id', companyId)
      .eq('flash_department_id', departmentId)
      .select('id');
    if (error) throw error;
    updated += data?.length || 0;
  }

  return updated;
}

async function listTimetableAllocationsByExternalId(companyId, startDate, endDate, externalId) {
  const apiKey = process.env.FLASH_API_KEY;
  if (!apiKey) throw new Error('FLASH_API_KEY não configurada.');

  const url = new URL('timetables/allocations', FLASH_ATTENDANCE_BASE_URL);
  url.searchParams.set('companyId', String(companyId));
  url.searchParams.set('startDate', `${startDate}T00:00:00.000Z`);
  url.searchParams.set('endDate', `${endDate}T23:59:59.999Z`);
  url.searchParams.set('externalId', String(externalId));

  const response = await fetch(url, {
    headers: {
      'x-flash-auth': apiKey,
      Accept: 'application/json',
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.message || `Flash API respondeu ${response.status}`);
    error.status = response.status;
    error.endpoint = `${url.origin}${url.pathname}`;
    error.requestId = payload?.request_id || payload?.requestId || null;
    throw error;
  }

  return Array.isArray(payload?.data) ? payload.data : [];
}

const isNoTimetableError = (error) => /timetables?\s+(default|allocations?)\s+not\s+found/i.test(String(error?.message || ''));

async function loadEmployeeScheduleWindow(company, employee, window) {
  const employeeId = String(employee?.flash_employee_id || '');
  const externalId = String(employee?.external_id || '');

  if (!employeeId && !externalId) {
    return {
      rows: [],
      errors: [{ window, error: new Error('Colaborador sem employeeId e externalId sincronizados.') }],
      fallbackUsed: false,
      empty: false,
    };
  }

  if (employeeId) {
    try {
      const rows = await listTimetableAllocations(company.id, window.startDate, window.endDate, employeeId);
      return { rows, errors: [], fallbackUsed: false, empty: rows.length === 0 };
    } catch (employeeIdError) {
      if (isNoTimetableError(employeeIdError)) {
        return { rows: [], errors: [], fallbackUsed: false, empty: true };
      }

      if (!externalId) {
        return { rows: [], errors: [{ window, error: employeeIdError }], fallbackUsed: false, empty: false };
      }

      try {
        const rows = await listTimetableAllocationsByExternalId(company.id, window.startDate, window.endDate, externalId);
        return { rows, errors: [], fallbackUsed: true, empty: rows.length === 0 };
      } catch (externalIdError) {
        if (isNoTimetableError(externalIdError)) {
          return { rows: [], errors: [], fallbackUsed: true, empty: true };
        }
        externalIdError.message = `employeeId: ${employeeIdError?.message || 'falhou'}; externalId: ${externalIdError?.message || 'falhou'}`;
        return { rows: [], errors: [{ window, error: externalIdError }], fallbackUsed: true, empty: false };
      }
    }
  }

  try {
    const rows = await listTimetableAllocationsByExternalId(company.id, window.startDate, window.endDate, externalId);
    return { rows, errors: [], fallbackUsed: true, empty: rows.length === 0 };
  } catch (error) {
    if (isNoTimetableError(error)) {
      return { rows: [], errors: [], fallbackUsed: true, empty: true };
    }
    return { rows: [], errors: [{ window, error }], fallbackUsed: true, empty: false };
  }
}

const allocationDedupKey = (allocation) => {
  if (allocation?.allocationId !== undefined && allocation?.allocationId !== null) {
    return `allocation:${allocation.allocationId}`;
  }
  return [
    allocation?.employeeId || allocation?.externalId || 'unknown',
    allocation?.timetableId || 'unknown',
    String(allocation?.allocationStartDate || '').slice(0, 10) || 'unknown',
  ].join(':');
};

async function loadScheduleAllocations(company, employees, windows, onProgress) {
  const allocations = [];
  const warnings = [];
  let externalIdFallbacks = 0;
  let monthQueries = 0;
  let emptyMonths = 0;
  const concurrency = 5;

  for (let index = 0; index < employees.length; index += concurrency) {
    const batch = employees.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async (employee) => {
      const rows = [];
      const errors = [];
      let fallbackCount = 0;
      let checkedMonths = 0;
      let employeeEmptyMonths = 0;

      for (const window of windows) {
        checkedMonths += 1;
        const result = await loadEmployeeScheduleWindow(company, employee, window);
        rows.push(...result.rows);
        errors.push(...result.errors);
        if (result.fallbackUsed) fallbackCount += 1;
        if (result.empty) employeeEmptyMonths += 1;
      }

      return {
        employee,
        rows,
        errors,
        fallbackCount,
        checkedMonths,
        emptyMonths: employeeEmptyMonths,
      };
    }));

    results.forEach(({ employee, rows, errors, fallbackCount, checkedMonths, emptyMonths: employeeEmptyMonths }) => {
      allocations.push(...rows);
      externalIdFallbacks += fallbackCount;
      monthQueries += checkedMonths;
      emptyMonths += employeeEmptyMonths;

      errors.forEach(({ window, error }) => {
        warnings.push({
          employeeId: employee?.flash_employee_id || null,
          externalId: employee?.external_id || null,
          employeeName: employee?.employee_name || null,
          month: window.month,
          message: error?.message || 'Falha ao consultar horário.',
          flashStatus: error?.status || null,
          flashEndpoint: error?.endpoint || null,
          flashRequestId: error?.requestId || null,
        });
      });
    });

    await onProgress({
      processed: Math.min(index + batch.length, employees.length),
      total: employees.length,
      allocationsFound: allocations.length,
      warnings: warnings.length,
      externalIdFallbacks,
      monthQueries,
      emptyMonths,
    });
  }

  const uniqueAllocations = new Map();
  allocations.forEach((allocation) => uniqueAllocations.set(allocationDedupKey(allocation), allocation));

  return {
    allocations: [...uniqueAllocations.values()],
    warnings,
    externalIdFallbacks,
    monthQueries,
    emptyMonths,
  };
}

async function syncEmployees({ supabase, userId, company, runId, syncedAt }) {
  await updateRun(supabase, runId, { current_stage: 'Consultando funcionários na Flash' });

  const [employees, departmentsById] = await Promise.all([
    listEmployees(company.id),
    loadSyncedDepartmentsMap(supabase, userId, company.id),
  ]);

  const common = companyFields(company);
  const unmatchedDepartmentIds = new Set();
  let employeesWithDepartmentId = 0;
  let employeesWithDepartmentName = 0;

  const rows = employees
    .filter((employee) => employee?.id && employee?.name)
    .map((employee) => {
      const department = firstDepartmentFromEmployee(employee, departmentsById, company.id);
      if (department.id) {
        employeesWithDepartmentId += 1;
        if (department.name) employeesWithDepartmentName += 1;
        else unmatchedDepartmentIds.add(department.id);
      }

      return {
        user_id: userId,
        ...common,
        flash_employee_id: String(employee.id),
        external_id: employee.externalId || null,
        employee_name: String(employee.name),
        status: employee.status || null,
        flash_department_id: department.id,
        department_name: department.name,
        raw_payload: sanitizeEmployee(employee),
        synced_at: syncedAt,
      };
    });

  await updateRun(supabase, runId, {
    current_stage: departmentsById.size
      ? `Gravando funcionários (${employeesWithDepartmentName}/${rows.length} com nome de departamento resolvido)`
      : `Gravando funcionários (${employeesWithDepartmentId}/${rows.length} com ID de departamento; nomes serão resolvidos ao sincronizar Departamentos)`,
    current_company_employees_total: rows.length,
    current_company_employees_processed: rows.length,
  });

  await upsertChunks(supabase, 'flash_employees', rows, 'user_id,flash_company_id,flash_employee_id');
  await cleanupStaleRows(supabase, 'flash_employees', userId, company.id, syncedAt);

  let backfilled = 0;
  if (departmentsById.size > 0) {
    await updateRun(supabase, runId, { current_stage: 'Confirmando vínculos de departamento já conhecidos' });
    backfilled = await backfillEmployeeDepartments(supabase, userId, company.id, departmentsById);
  }

  const warnings = [];
  if (departmentsById.size > 0 && unmatchedDepartmentIds.size > 0) {
    warnings.push({
      message: `${unmatchedDepartmentIds.size} ID(s) de departamento retornado(s) nos funcionários ainda não existem na lista de departamentos sincronizada.`,
      departmentIds: [...unmatchedDepartmentIds].slice(0, 20),
    });
  }

  return {
    employeesProcessed: rows.length,
    departmentsProcessed: 0,
    allocationsProcessed: 0,
    warningCount: warnings.length,
    warnings,
    departmentLinks: {
      departmentsAvailable: departmentsById.size,
      employeesWithDepartmentId,
      employeesWithDepartmentName,
      employeesBackfilled: backfilled,
      unmatchedDepartmentIds: [...unmatchedDepartmentIds],
    },
  };
}

async function syncDepartments({ supabase, userId, company, runId, syncedAt }) {
  await updateRun(supabase, runId, { current_stage: 'Consultando departamentos na Flash' });
  const departments = await listDepartments(company.id);
  const common = companyFields(company);

  const rows = departments
    .filter((department) => department?.id && department?.name)
    .map((department) => ({
      user_id: userId,
      ...common,
      flash_department_id: String(department.id),
      name: String(department.name),
      description: department.description || null,
      external_id: department.externalId || null,
      is_active: typeof department.isActive === 'boolean' ? department.isActive : null,
      raw_payload: department,
      synced_at: syncedAt,
    }));

  await updateRun(supabase, runId, { current_stage: `Gravando ${rows.length} departamentos no Supabase` });
  await upsertChunks(supabase, 'flash_departments', rows, 'user_id,flash_company_id,flash_department_id');
  await cleanupStaleRows(supabase, 'flash_departments', userId, company.id, syncedAt);

  const departmentsById = new Map(rows.map((department) => [department.flash_department_id, department.name]));
  await updateRun(supabase, runId, { current_stage: 'Vinculando nomes dos departamentos aos funcionários já sincronizados' });
  const employeesBackfilled = await backfillEmployeeDepartments(supabase, userId, company.id, departmentsById);

  return {
    employeesProcessed: 0,
    departmentsProcessed: rows.length,
    allocationsProcessed: 0,
    warningCount: 0,
    warnings: [],
    departmentLinks: {
      departmentsAvailable: rows.length,
      employeesBackfilled,
    },
  };
}

async function syncSchedules({ supabase, userId, company, runId, syncedAt }) {
  const { data: employees, error: employeesError } = await supabase
    .from('flash_employees')
    .select('flash_employee_id,external_id,employee_name')
    .eq('user_id', userId)
    .eq('flash_company_id', company.id)
    .order('employee_name');
  if (employeesError) throw employeesError;

  if (!employees?.length) {
    const error = new Error(`Nenhum funcionário sincronizado para ${company.name}. Sincronize os funcionários desta empresa antes dos horários.`);
    error.statusCode = 409;
    throw error;
  }

  const windows = scheduleWindows();
  const firstWindow = windows[0];
  const lastWindow = windows[windows.length - 1];
  const windowSummary = {
    startDate: firstWindow?.startDate || SCHEDULE_HISTORY_START,
    endDate: lastWindow?.endDate || SCHEDULE_HISTORY_START,
    months: windows.length,
  };

  await updateRun(supabase, runId, {
    current_stage: `Consultando horários mês a mês desde jan/2026 (${windows.length} competências)`,
    current_company_employees_total: employees.length,
    current_company_employees_processed: 0,
  });

  const {
    allocations,
    warnings,
    externalIdFallbacks,
    monthQueries,
    emptyMonths,
  } = await loadScheduleAllocations(
    company,
    employees,
    windows,
    async ({ processed, total, allocationsFound, warnings: warningCount }) => {
      await updateRun(supabase, runId, {
        current_stage: `Consultando horários mês a mês desde jan/2026 (${windows.length} competências)`,
        current_company_employees_total: total,
        current_company_employees_processed: processed,
        allocations_processed: allocationsFound,
        warning_count: warningCount,
      });
    },
  );

  const employeeNames = new Map(employees.map((employee) => [String(employee.flash_employee_id), employee.employee_name]));
  const employeeExternalIds = new Map(employees.map((employee) => [String(employee.flash_employee_id), employee.external_id]));
  const common = companyFields(company);

  const rows = allocations
    .filter((allocation) => allocation?.employeeId || allocation?.externalId)
    .map((allocation) => {
      const allocationEmployeeId = String(allocation.employeeId || '');
      const allocationExternalId = String(allocation.externalId || '');
      const matchedEmployee = allocationEmployeeId
        ? employees.find((employee) => String(employee.flash_employee_id) === allocationEmployeeId)
        : employees.find((employee) => String(employee.external_id || '') === allocationExternalId);
      const employeeId = allocationEmployeeId || String(matchedEmployee?.flash_employee_id || '');
      const parsed = parseTimetableName(allocation.timetableName);
      const allocationStartDate = String(allocation.allocationStartDate || '').slice(0, 10) || null;
      const identity = allocation.allocationId
        ? `allocation:${allocation.allocationId}`
        : `timetable:${allocation.timetableId || 'unknown'}:${allocationStartDate || 'unknown'}`;

      return {
        user_id: userId,
        ...common,
        source_key: `${company.id}:${employeeId || allocationExternalId}:${identity}`,
        flash_employee_id: employeeId || null,
        external_id: allocationExternalId || employeeExternalIds.get(employeeId) || matchedEmployee?.external_id || null,
        employee_name: allocation.employeeName || employeeNames.get(employeeId) || matchedEmployee?.employee_name || null,
        timetable_id: Number.isFinite(Number(allocation.timetableId)) ? Number(allocation.timetableId) : null,
        timetable_name: allocation.timetableName || null,
        allocation_id: Number.isFinite(Number(allocation.allocationId)) ? Number(allocation.allocationId) : null,
        allocation_start_date: allocationStartDate,
        scheduled_entry: parsed.entry,
        break_start: parsed.breakStart,
        break_end: parsed.breakEnd,
        scheduled_exit: parsed.exit,
        schedule_times: parsed.times,
        raw_payload: allocation,
        synced_at: syncedAt,
      };
    });

  await updateRun(supabase, runId, { current_stage: 'Gravando horários no Supabase' });
  await upsertChunks(supabase, 'employee_schedule_allocations', rows, 'user_id,source_key');

  return {
    employeesProcessed: employees.length,
    departmentsProcessed: 0,
    allocationsProcessed: rows.length,
    warningCount: warnings.length,
    warnings,
    externalIdFallbacks,
    monthQueries,
    emptyMonths,
    scheduleWindow: windowSummary,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  if (!process.env.FLASH_API_KEY) return res.status(500).json({ stage: 'configuração', error: 'FLASH_API_KEY não configurada.' });

  const { companyKey, target } = req.body || {};
  if (!companyKey || !VALID_TARGETS.has(target)) {
    return res.status(400).json({ error: 'Informe uma empresa e um tipo de sincronização válidos.' });
  }

  const company = getFlashCompanies().find((item) => item.key === companyKey);
  if (!company) return res.status(404).json({ error: 'Empresa não encontrada na configuração.' });
  if (!company.id) {
    return res.status(500).json({
      stage: 'configuração da empresa',
      error: `${company.env} não configurado no .env.`,
    });
  }

  let supabase = null;
  let runId = null;
  let stage = 'configuração do backend';

  try {
    supabase = getServerClient();

    stage = 'autenticação da sessão';
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) return res.status(401).json({ stage, error: 'Sessão inválida ou expirada.' });
    const userId = authData.user.id;

    runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    stage = 'criação do histórico de sincronização';
    const { error: runError } = await supabase.from('flash_structure_sync_runs').insert({
      id: runId,
      user_id: userId,
      status: 'running',
      flash_company_id: company.id,
      company_key: company.key,
      company_name: company.name,
      company_cnpj: company.cnpj,
      sync_target: target,
      companies_total: 1,
      companies_processed: 0,
      current_company_index: 1,
      current_company_name: company.name,
      current_stage: 'Preparando sincronização',
      current_company_employees_total: 0,
      current_company_employees_processed: 0,
      started_at: startedAt,
      progress_updated_at: startedAt,
    });
    if (runError) throw runError;

    const syncedAt = new Date().toISOString();
    stage = `${target} - ${company.name}`;

    let result;
    if (target === 'employees') result = await syncEmployees({ supabase, userId, company, runId, syncedAt });
    if (target === 'departments') result = await syncDepartments({ supabase, userId, company, runId, syncedAt });
    if (target === 'schedules') result = await syncSchedules({ supabase, userId, company, runId, syncedAt });

    const finishedAt = new Date().toISOString();
    const firstWarning = result.warnings?.[0] || null;
    const errorMessage = result.warningCount
      ? target === 'schedules'
        ? `${result.warningCount} consulta(s) mensal(is) tiveram falha ao consultar horário. Primeiro aviso: ${firstWarning?.employeeName || 'colaborador'}${firstWarning?.month ? ` (${firstWarning.month})` : ''} — ${firstWarning?.message || 'falha não detalhada'}${firstWarning?.flashStatus ? ` [Flash HTTP ${firstWarning.flashStatus}]` : ''}`.slice(0, 1000)
        : `${result.warningCount} aviso(s) de vínculo cadastral.`
      : null;

    const { error: finishError } = await supabase.from('flash_structure_sync_runs').update({
      status: 'completed',
      companies_processed: 1,
      employees_processed: result.employeesProcessed,
      departments_processed: result.departmentsProcessed,
      allocations_processed: result.allocationsProcessed,
      warning_count: result.warningCount,
      current_stage: 'Sincronização concluída',
      current_company_employees_processed: target === 'schedules' ? result.employeesProcessed : 0,
      progress_updated_at: finishedAt,
      error_message: errorMessage,
      finished_at: finishedAt,
    }).eq('id', runId);
    if (finishError) throw finishError;

    return res.status(200).json({
      success: true,
      syncRunId: runId,
      companyKey: company.key,
      companyName: company.name,
      target,
      employeesProcessed: result.employeesProcessed,
      departmentsProcessed: result.departmentsProcessed,
      allocationsProcessed: result.allocationsProcessed,
      warningCount: result.warningCount,
      warnings: result.warnings.slice(0, 20),
      externalIdFallbacks: result.externalIdFallbacks || 0,
      monthQueries: result.monthQueries || 0,
      emptyMonths: result.emptyMonths || 0,
      departmentLinks: result.departmentLinks || null,
      scheduleWindow: result.scheduleWindow || null,
      finishedAt,
    });
  } catch (error) {
    console.error(`Falha na sincronização Flash [${stage}]:`, error);

    if (supabase && runId) {
      const finishedAt = new Date().toISOString();
      await supabase.from('flash_structure_sync_runs').update({
        status: 'failed',
        current_stage: `Falha: ${stage}`,
        progress_updated_at: finishedAt,
        finished_at: finishedAt,
        error_message: `[${stage}] ${String(error?.message || error)}`.slice(0, 1000),
      }).eq('id', runId);
    }

    return res.status(error?.statusCode || 500).json({
      stage,
      error: error?.message || 'Falha ao sincronizar dados da Flash.',
      flashStatus: error?.status || null,
      flashEndpoint: error?.endpoint || null,
      flashRequestId: error?.requestId || null,
    });
  }
}
