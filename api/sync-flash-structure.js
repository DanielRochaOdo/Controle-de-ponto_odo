import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  listDepartments,
  listEmployees,
  listTimetableAllocations,
  parseTimetableName,
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

const scheduleWindow = () => {
  const timeZone = process.env.APP_TIMEZONE || 'America/Fortaleza';
  const today = dateForTimezone(new Date(), timeZone);
  const year = Number(today.slice(0, 4));
  return {
    startDate: `${year - 2}-01-01`,
    endDate: today,
  };
};

const sanitizeEmployee = (employee) => {
  if (!employee || typeof employee !== 'object') return employee;
  const {
    documentNumber,
    email,
    corporateEmail,
    phoneNumber,
    profilePicture,
    ...safe
  } = employee;
  return safe;
};

const firstDepartment = (employee, departmentsById) => {
  const departments = Array.isArray(employee?.departments) ? employee.departments : [];
  const first = departments[0] || null;
  const id = String(pick(first, ['id', 'departmentId']) || pick(employee, ['departmentId']) || '');
  const name = String(pick(first, ['name']) || (id ? departmentsById.get(id)?.name : '') || '');
  return { id: id || null, name: name || null };
};

async function upsertChunks(supabase, table, rows, onConflict, size = 500) {
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    if (!chunk.length) continue;
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw error;
  }
}

async function loadAllocations(companyId, employees, startDate, endDate) {
  const allocations = [];
  const warnings = [];
  const concurrency = 5;

  for (let index = 0; index < employees.length; index += concurrency) {
    const batch = employees.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async (employee) => {
      const employeeId = String(employee?.id || '');
      if (!employeeId) return { employee, rows: [], error: new Error('Colaborador sem employeeId na resposta da Flash.') };
      try {
        const rows = await listTimetableAllocations(companyId, startDate, endDate, employeeId);
        return { employee, rows, error: null };
      } catch (error) {
        return { employee, rows: [], error };
      }
    }));

    results.forEach(({ employee, rows, error }) => {
      if (error) {
        warnings.push({
          employeeId: employee?.id || null,
          employeeName: employee?.name || null,
          message: error?.message || 'Falha ao consultar escala.',
          flashStatus: error?.status || null,
          flashEndpoint: error?.endpoint || null,
          flashRequestId: error?.requestId || null,
        });
        return;
      }
      allocations.push(...rows);
    });
  }

  return { allocations, warnings };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });

  const companyId = process.env.FLASH_COMPANY_ID;
  if (!companyId) return res.status(500).json({ stage: 'configuração', error: 'FLASH_COMPANY_ID não configurado.' });
  if (!process.env.FLASH_API_KEY) return res.status(500).json({ stage: 'configuração', error: 'FLASH_API_KEY não configurada.' });

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
    stage = 'criação do histórico de sincronização';
    const { error: runError } = await supabase.from('flash_structure_sync_runs').insert({
      id: runId,
      user_id: userId,
      status: 'running',
      started_at: new Date().toISOString(),
    });
    if (runError) throw runError;

    stage = 'consulta de colaboradores e departamentos na Flash';
    const [employees, departments] = await Promise.all([
      listEmployees(companyId),
      listDepartments(companyId),
    ]);

    const syncedAt = new Date().toISOString();
    const departmentsById = new Map(departments.map((department) => [String(department?.id || ''), department]));

    const departmentRows = departments
      .filter((department) => department?.id && department?.name)
      .map((department) => ({
        user_id: userId,
        flash_department_id: String(department.id),
        name: String(department.name),
        description: department.description || null,
        external_id: department.externalId || null,
        is_active: typeof department.isActive === 'boolean' ? department.isActive : null,
        raw_payload: department,
        synced_at: syncedAt,
      }));

    const employeeRows = employees
      .filter((employee) => employee?.id && employee?.name)
      .map((employee) => {
        const department = firstDepartment(employee, departmentsById);
        return {
          user_id: userId,
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

    stage = 'gravação de colaboradores e departamentos';
    await Promise.all([
      upsertChunks(supabase, 'flash_departments', departmentRows, 'user_id,flash_department_id'),
      upsertChunks(supabase, 'flash_employees', employeeRows, 'user_id,flash_employee_id'),
    ]);

    const window = scheduleWindow();
    stage = 'consulta das escalas por colaborador na Flash';
    const { allocations, warnings } = await loadAllocations(companyId, employees, window.startDate, window.endDate);

    const employeeNames = new Map(employeeRows.map((employee) => [employee.flash_employee_id, employee.employee_name]));
    const employeeExternalIds = new Map(employeeRows.map((employee) => [employee.flash_employee_id, employee.external_id]));

    const allocationRows = allocations
      .filter((allocation) => allocation?.employeeId)
      .map((allocation) => {
        const employeeId = String(allocation.employeeId);
        const parsed = parseTimetableName(allocation.timetableName);
        const allocationStartDate = String(allocation.allocationStartDate || '').slice(0, 10) || null;
        const identity = allocation.allocationId
          ? `allocation:${allocation.allocationId}`
          : `timetable:${allocation.timetableId || 'unknown'}:${allocationStartDate || 'unknown'}`;

        return {
          user_id: userId,
          source_key: `${employeeId}:${identity}`,
          flash_employee_id: employeeId,
          external_id: allocation.externalId || employeeExternalIds.get(employeeId) || null,
          employee_name: allocation.employeeName || employeeNames.get(employeeId) || null,
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

    stage = 'gravação das escalas';
    await upsertChunks(supabase, 'employee_schedule_allocations', allocationRows, 'user_id,source_key');

    const finishedAt = new Date().toISOString();
    stage = 'finalização da sincronização';
    const { error: finishError } = await supabase.from('flash_structure_sync_runs').update({
      status: 'completed',
      employees_processed: employeeRows.length,
      departments_processed: departmentRows.length,
      allocations_processed: allocationRows.length,
      warning_count: warnings.length,
      error_message: warnings.length ? `${warnings.length} colaborador(es) tiveram falha ao consultar escala.` : null,
      finished_at: finishedAt,
    }).eq('id', runId);
    if (finishError) throw finishError;

    return res.status(200).json({
      success: true,
      syncRunId: runId,
      employeesProcessed: employeeRows.length,
      departmentsProcessed: departmentRows.length,
      allocationsProcessed: allocationRows.length,
      warningCount: warnings.length,
      warnings: warnings.slice(0, 10),
      scheduleWindow: window,
      finishedAt,
    });
  } catch (error) {
    console.error(`Falha na sincronização da estrutura Flash [${stage}]:`, error);

    if (supabase && runId) {
      await supabase.from('flash_structure_sync_runs').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: `[${stage}] ${String(error?.message || error)}`.slice(0, 1000),
      }).eq('id', runId);
    }

    return res.status(500).json({
      stage,
      error: error?.message || 'Falha ao sincronizar a estrutura da Flash.',
      flashStatus: error?.status || null,
      flashEndpoint: error?.endpoint || null,
      flashRequestId: error?.requestId || null,
    });
  }
}
