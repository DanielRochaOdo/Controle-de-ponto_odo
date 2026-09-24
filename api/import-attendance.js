import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  dateRange,
  listAttendanceDay,
  normalizeAttendanceDay,
  getEmployeeById,
  listEmployees,
} from './_lib/flash.js';
import {
  attendanceIdentity,
  createEmployeeDirectory,
  EmployeeIdentityError,
  identifier,
  missingAttendanceEmployees,
} from './_lib/employeeDirectory.js';
import { getConfiguredFlashCompanies, getMissingFlashCompanies } from './_lib/flashCompanies.js';

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

async function fetchDays(company, days) {
  const result = [];
  const concurrency = 5;
  for (let index = 0; index < days.length; index += concurrency) {
    const batch = days.slice(index, index + concurrency);
    const responses = await Promise.all(batch.map(async (day) => ({
      day,
      attendance: await listAttendanceDay(company.id, day),
    })));
    result.push(...responses);
  }
  return result;
}

async function fetchAllSyncedRows(supabase, table, userId, orderColumn) {
  const result = [];
  const batchSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .order(orderColumn, { ascending: true })
      .range(offset, offset + batchSize - 1);
    if (error) throw error;
    const batch = data || [];
    result.push(...batch);
    if (batch.length < batchSize) break;
    offset += batchSize;
  }

  return result;
}

/**
 * Uma resposta de marcação não é cadastro de pessoas. Consulta o endpoint
 * oficial de detalhe do Core somente para IDs ausentes na listagem previamente
 * sincronizada; sem correspondência comprovada, interrompe a importação.
 */
export async function reconcileAttendanceEmployees({ company, userId, supabase, dailyPayloads, employees }) {
  let directory = createEmployeeDirectory(employees, company.id);
  const missing = missingAttendanceEmployees(dailyPayloads, directory);
  if (!missing.length) return { employees, directory, recovered: 0 };

  const ids = [...new Set(missing.map((identity) => identity.id).filter(Boolean))];
  const externalOnly = [...new Set(missing.filter((identity) => !identity.id).map((identity) => identity.externalId))];
  if (ids.length + externalOnly.length > 100) {
    throw new EmployeeIdentityError(
      'FLASH_CORE_RECONCILIATION_LIMIT',
      `${company.name}: ${ids.length + externalOnly.length} identificadores ausentes na lista Core. Sincronização cadastral incompleta; importação interrompida.`,
      { companyId: company.id },
    );
  }

  console.info('[Flash] Reconciliando IDs ausentes no Core', {
    companyId: company.id, missingEmployeeIds: ids.length, missingExternalIds: externalOnly.length,
  });

  const details = [];
  for (let index = 0; index < ids.length; index += 5) {
    const batch = ids.slice(index, index + 5);
    const rows = await Promise.all(batch.map(async (employeeId) => {
      try {
        return await getEmployeeById(company.id, employeeId);
      } catch (cause) {
        throw new EmployeeIdentityError(
          'FLASH_CORE_EMPLOYEE_UNRESOLVED',
          `A marcação de ${company.name} referencia employeeId=${employeeId}, mas o cadastro individual não foi obtido no Core (${cause.message}). Confira a empresa e o vínculo desse funcionário na Flash.`,
          { companyId: company.id, employeeId },
        );
      }
    }));
    details.push(...rows);
  }

  // O Core também documenta a pesquisa por externalIds na própria listagem.
  // Ela só é utilizada para matrículas sem employeeId, uma vez por ID distinto.
  for (let index = 0; index < externalOnly.length; index += 5) {
    const group = externalOnly.slice(index, index + 5);
    const retrieved = await Promise.all(group.map(async (externalId) => {
      const candidates = await listEmployees(company.id, { externalIds: externalId });
      const matches = candidates.filter((candidate) => identifier(candidate.externalId) === externalId);
      if (matches.length !== 1) {
        throw new EmployeeIdentityError(
          'FLASH_CORE_EMPLOYEE_UNRESOLVED',
          `A matrícula externa ${externalId} de ${company.name} não foi associada de maneira única na API Core. Verifique o cadastro do colaborador na Flash.`,
          { companyId: company.id, externalId },
        );
      }
      return matches[0];
    }));
    details.push(...retrieved);
  }

  const distinctDetails = [...new Map(details.map((employee) => [employee.id, employee])).values()];

  const { data: syncedDepartments, error: departmentsError } = await supabase
    .from('flash_departments')
    .select('flash_department_id,name')
    .eq('user_id', userId)
    .eq('flash_company_id', company.id);
  if (departmentsError) throw departmentsError;
  const departmentNames = new Map((syncedDepartments || []).map((department) => [
    identifier(department.flash_department_id), department.name,
  ]));

  const syncedAt = new Date().toISOString();
  const recoveredRows = distinctDetails.map((employee) => {
    const employment = (Array.isArray(employee.employments) ? employee.employments : [])
      .find((item) => identifier(item.companyId) === company.id);
    const companyDepartments = Array.isArray(employment?.departments) ? employment.departments : [];
    const topLevelDepartments = Array.isArray(employee.departments) ? employee.departments : [];
    const firstDepartment = companyDepartments[0] || topLevelDepartments[0] || employee.departmentId || null;
    const departmentId = identifier(
      firstDepartment && typeof firstDepartment === 'object'
        ? firstDepartment.id || firstDepartment.departmentId
        : firstDepartment,
    );
    if (departmentId && !departmentNames.has(departmentId)) {
      throw new EmployeeIdentityError(
        'FLASH_CORE_DEPARTMENT_UNRESOLVED',
        `Colaborador ${employee.id} de ${company.name} tem departamento ${departmentId} não encontrado na Estrutura Flash. Sincronize Departamentos antes de importar.`,
        { companyId: company.id, employeeId: employee.id, departmentId },
      );
    }
    const { documentNumber, pis, email, corporateEmail, phoneNumber, profilePicture, ...safe } = employee;
    return {
      user_id: userId,
      flash_company_id: company.id,
      company_key: company.key,
      company_name: company.name,
      company_cnpj: company.cnpj,
      flash_employee_id: employee.id,
      external_id: identifier(employee.externalId) || null,
      employee_name: employee.name.trim(),
      status: employee.status || null,
      flash_department_id: departmentId || null,
      department_name: departmentId ? departmentNames.get(departmentId) || null : null,
      raw_payload: safe,
      synced_at: syncedAt,
    };
  });

  const { error: upsertError } = await supabase.from('flash_employees')
    .upsert(recoveredRows, { onConflict: 'user_id,flash_company_id,flash_employee_id' });
  if (upsertError) throw upsertError;

  const merged = [...employees, ...recoveredRows];
  directory = createEmployeeDirectory(merged, company.id);
  const unresolved = missingAttendanceEmployees(dailyPayloads, directory);
  if (unresolved.length) {
    const sample = unresolved.slice(0, 10).map(({ id, externalId, day }) =>
      `employeeId=${id || 'ausente'},externalId=${externalId || 'ausente'},dia=${day}`).join('; ');
    throw new EmployeeIdentityError(
      'FLASH_ATTENDANCE_EMPLOYEE_UNRESOLVED',
      `Flash retornou IDs conflitantes ou sem vínculo Core em ${company.name}: ${sample}. Importação interrompida.`,
      { companyId: company.id },
    );
  }
  console.info('[Flash] Colaboradores conciliados com o Core', {
    companyId: company.id, recoveredEmployees: recoveredRows.length,
  });
  return { employees: merged, directory, recovered: recoveredRows.length };
}

const rowsForCompany = (rows, company) => rows.filter((row) => row.flash_company_id === company.id);

const companyFields = (company) => ({
  flash_company_id: company.id,
  company_key: company.key,
  company_name: company.name,
  company_cnpj: company.cnpj,
});

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

  if (!process.env.FLASH_API_KEY) return res.status(500).json({ stage: 'configuração', error: 'FLASH_API_KEY não configurada.' });

  const missingCompanies = getMissingFlashCompanies();
  if (missingCompanies.length) {
    return res.status(500).json({
      stage: 'configuração das empresas',
      error: `Faltam Company IDs da Flash no .env: ${missingCompanies.map((company) => company.env).join(', ')}`,
    });
  }
  const companies = getConfiguredFlashCompanies();

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

    stage = 'carregamento da estrutura sincronizada';
    const [
      { data: settingsRow, error: settingsError },
      employees,
      allocations,
      { data: employeeSyncRuns, error: structureSyncError },
    ] = await Promise.all([
      supabase.from('attendance_settings').select('*').eq('user_id', userId).maybeSingle(),
      fetchAllSyncedRows(supabase, 'flash_employees', userId, 'flash_employee_id'),
      fetchAllSyncedRows(supabase, 'employee_schedule_allocations', userId, 'allocation_start_date'),
      supabase.from('flash_structure_sync_runs')
        .select('company_key,finished_at')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .eq('sync_target', 'employees'),
    ]);
    if (settingsError) throw settingsError;
    if (structureSyncError) throw structureSyncError;

    const companiesWithEmployeeSync = new Set((employeeSyncRuns || []).map((run) => run.company_key).filter(Boolean));
    const companiesMissingEmployeeSync = companies.filter((company) => !companiesWithEmployeeSync.has(company.key));
    if (companiesMissingEmployeeSync.length) {
      return res.status(409).json({
        stage: 'estrutura da Flash',
        error: `Sincronize os funcionários destas empresas antes de atualizar os registros: ${companiesMissingEmployeeSync.map((company) => company.name).join(', ')}.`,
      });
    }

    const settings = { ...defaultSettings, ...(settingsRow || {}) };

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

    const allRows = [];
    const companyResults = [];

    for (const company of companies) {
      const companyEmployees = rowsForCompany(employees, company);
      const companyAllocations = rowsForCompany(allocations, company);

      stage = `consulta das marcações diárias - ${company.name}`;
      const dailyPayloads = await fetchDays(company, days);

      stage = `conciliação dos IDs com o cadastro Core - ${company.name}`;
      const resolved = await reconcileAttendanceEmployees({
        company, userId, supabase, dailyPayloads, employees: companyEmployees,
      });

      stage = `normalização previsto x realizado - ${company.name}`;
      const rows = dailyPayloads.flatMap(({ day, attendance }) => normalizeAttendanceDay({
        day,
        attendance,
        employees: resolved.employees,
        directory: resolved.directory,
        allocations: companyAllocations,
        settings,
        companyId: company.id,
        userId,
        importRunId: runId,
      }).map((row) => ({ ...row, ...companyFields(company) })));

      allRows.push(...rows);
      companyResults.push({
        companyKey: company.key,
        companyName: company.name,
        recordsProcessed: rows.length,
        employeesAvailable: resolved.employees.length,
        employeesRecoveredFromCore: resolved.recovered,
        schedulesAvailable: companyAllocations.length,
      });
    }

    stage = 'gravação dos registros multiempresa no Supabase';
    for (let index = 0; index < allRows.length; index += 500) {
      const chunk = allRows.slice(index, index + 500);
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
        companies_processed: companies.length,
        finished_at: finishedAt,
        employees_processed: employees.filter((employee) => employee.flash_company_id).length,
        records_processed: allRows.length,
      })
      .eq('id', runId);
    if (finishError) throw finishError;

    return res.status(200).json({
      success: true,
      importRunId: runId,
      startDate,
      endDate: effectiveEndDate,
      requestedEndDate,
      companiesProcessed: companies.length,
      employeesProcessed: employees.filter((employee) => employee.flash_company_id).length,
      schedulesAvailable: allocations.filter((allocation) => allocation.flash_company_id).length,
      recordsProcessed: allRows.length,
      companies: companyResults,
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
      code: error?.code || null,
      flashStatus: error?.status || null,
      flashEndpoint: error?.endpoint || null,
      flashRequestId: error?.requestId || null,
    });
  }
}
