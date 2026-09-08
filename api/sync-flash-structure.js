import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  listDepartments,
  listEmployees,
  listTimetableAllocations,
  parseTimetableName,
} from './_lib/flash.js';
import { getConfiguredFlashCompanies, getMissingFlashCompanies } from './_lib/flashCompanies.js';

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
  return { startDate: `${year - 2}-01-01`, endDate: today };
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

async function updateProgress(supabase, runId, values) {
  if (!supabase || !runId) return;
  const { error } = await supabase
    .from('flash_structure_sync_runs')
    .update({ ...values, progress_updated_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) throw error;
}

async function loadAllocations(company, employees, startDate, endDate, onProgress) {
  const allocations = [];
  const warnings = [];
  const concurrency = 5;

  for (let index = 0; index < employees.length; index += concurrency) {
    const batch = employees.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async (employee) => {
      const employeeId = String(employee?.id || '');
      if (!employeeId) return { employee, rows: [], error: new Error('Colaborador sem employeeId na resposta da Flash.') };
      try {
        const rows = await listTimetableAllocations(company.id, startDate, endDate, employeeId);
        return { employee, rows, error: null };
      } catch (error) {
        return { employee, rows: [], error };
      }
    }));

    results.forEach(({ employee, rows, error }) => {
      if (error) {
        warnings.push({
          companyKey: company.key,
          companyName: company.name,
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

    if (onProgress) {
      await onProgress({
        processed: Math.min(index + batch.length, employees.length),
        total: employees.length,
        allocationsFound: allocations.length,
        warnings: warnings.length,
      });
    }
  }

  if (employees.length === 0 && onProgress) {
    await onProgress({ processed: 0, total: 0, allocationsFound: 0, warnings: 0 });
  }

  return { allocations, warnings };
}

function companyFields(company) {
  return {
    flash_company_id: company.id,
    company_key: company.key,
    company_name: company.name,
    company_cnpj: company.cnpj,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  if (!process.env.FLASH_API_KEY) return res.status(500).json({ stage: 'configuração', error: 'FLASH_API_KEY não configurada.' });

  const missingCompanies = getMissingFlashCompanies();
  if (missingCompanies.length) {
    return res.status(500).json({
      stage: 'configuração das empresas',
      error: `Faltam Company IDs da Flash no .env: ${missingCompanies.map((company) => company.env).join(', ')}`,
    });
  }

  const companies = getConfiguredFlashCompanies();
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
    const startedAt = new Date().toISOString();
    const { error: runError } = await supabase.from('flash_structure_sync_runs').insert({
      id: runId,
      user_id: userId,
      status: 'running',
      companies_total: companies.length,
      companies_processed: 0,
      current_company_index: 0,
      current_stage: 'Preparando sincronização',
      current_company_employees_total: 0,
      current_company_employees_processed: 0,
      started_at: startedAt,
      progress_updated_at: startedAt,
    });
    if (runError) throw runError;

    const syncedAt = new Date().toISOString();
    const window = scheduleWindow();
    const allDepartmentRows = [];
    const allEmployeeRows = [];
    const allAllocationRows = [];
    const allWarnings = [];
    const companyResults = [];

    for (let companyIndex = 0; companyIndex < companies.length; companyIndex += 1) {
      const company = companies[companyIndex];
      stage = `consulta de colaboradores e departamentos - ${company.name}`;
      await updateProgress(supabase, runId, {
        current_company_index: companyIndex + 1,
        current_company_name: company.name,
        current_stage: 'Consultando colaboradores e departamentos',
        current_company_employees_total: 0,
        current_company_employees_processed: 0,
      });

      const [employees, departments] = await Promise.all([
        listEmployees(company.id),
        listDepartments(company.id),
      ]);

      const departmentsById = new Map(departments.map((department) => [String(department?.id || ''), department]));
      const common = companyFields(company);

      const departmentRows = departments
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

      const employeeRows = employees
        .filter((employee) => employee?.id && employee?.name)
        .map((employee) => {
          const department = firstDepartment(employee, departmentsById);
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

      stage = `consulta das escalas por colaborador - ${company.name}`;
      await updateProgress(supabase, runId, {
        current_stage: 'Consultando escalas dos colaboradores',
        current_company_employees_total: employees.length,
        current_company_employees_processed: 0,
      });

      const { allocations, warnings } = await loadAllocations(
        company,
        employees,
        window.startDate,
        window.endDate,
        async ({ processed, total }) => {
          await updateProgress(supabase, runId, {
            current_stage: 'Consultando escalas dos colaboradores',
            current_company_employees_total: total,
            current_company_employees_processed: processed,
          });
        },
      );
      allWarnings.push(...warnings);

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
            ...common,
            source_key: `${company.id}:${employeeId}:${identity}`,
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

      allDepartmentRows.push(...departmentRows);
      allEmployeeRows.push(...employeeRows);
      allAllocationRows.push(...allocationRows);
      companyResults.push({
        companyKey: company.key,
        companyName: company.name,
        employeesProcessed: employeeRows.length,
        departmentsProcessed: departmentRows.length,
        allocationsProcessed: allocationRows.length,
        warningCount: warnings.length,
      });

      await updateProgress(supabase, runId, {
        companies_processed: companyIndex + 1,
        employees_processed: allEmployeeRows.length,
        departments_processed: allDepartmentRows.length,
        allocations_processed: allAllocationRows.length,
        warning_count: allWarnings.length,
        current_stage: 'Empresa concluída',
        current_company_employees_total: employees.length,
        current_company_employees_processed: employees.length,
      });
    }

    stage = 'gravação da estrutura multiempresa';
    await updateProgress(supabase, runId, {
      current_company_name: null,
      current_company_index: companies.length,
      current_stage: 'Gravando estrutura no Supabase',
      current_company_employees_total: 0,
      current_company_employees_processed: 0,
    });

    await Promise.all([
      upsertChunks(supabase, 'flash_departments', allDepartmentRows, 'user_id,flash_company_id,flash_department_id'),
      upsertChunks(supabase, 'flash_employees', allEmployeeRows, 'user_id,flash_company_id,flash_employee_id'),
    ]);
    await upsertChunks(supabase, 'employee_schedule_allocations', allAllocationRows, 'user_id,source_key');

    const finishedAt = new Date().toISOString();
    stage = 'finalização da sincronização';
    const { error: finishError } = await supabase.from('flash_structure_sync_runs').update({
      status: 'completed',
      companies_processed: companies.length,
      companies_total: companies.length,
      employees_processed: allEmployeeRows.length,
      departments_processed: allDepartmentRows.length,
      allocations_processed: allAllocationRows.length,
      warning_count: allWarnings.length,
      current_company_index: companies.length,
      current_company_name: null,
      current_stage: 'Sincronização concluída',
      current_company_employees_total: 0,
      current_company_employees_processed: 0,
      progress_updated_at: finishedAt,
      error_message: allWarnings.length ? `${allWarnings.length} colaborador(es) tiveram falha ao consultar escala.` : null,
      finished_at: finishedAt,
    }).eq('id', runId);
    if (finishError) throw finishError;

    return res.status(200).json({
      success: true,
      syncRunId: runId,
      companiesProcessed: companies.length,
      employeesProcessed: allEmployeeRows.length,
      departmentsProcessed: allDepartmentRows.length,
      allocationsProcessed: allAllocationRows.length,
      warningCount: allWarnings.length,
      warnings: allWarnings.slice(0, 20),
      companies: companyResults,
      scheduleWindow: window,
      finishedAt,
    });
  } catch (error) {
    console.error(`Falha na sincronização da estrutura Flash [${stage}]:`, error);

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

    return res.status(500).json({
      stage,
      error: error?.message || 'Falha ao sincronizar a estrutura da Flash.',
      flashStatus: error?.status || null,
      flashEndpoint: error?.endpoint || null,
      flashRequestId: error?.requestId || null,
    });
  }
}
