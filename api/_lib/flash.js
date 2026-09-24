import { TimeNormalizationError, normalizeFlashTemporal } from './timezone.js';
import { attendanceIdentity, createEmployeeDirectory, EmployeeIdentityError, identifier } from './employeeDirectory.js';

const FLASH_CORE_BASE_URL = 'https://api.flashapp.services/core/v1/';
const FLASH_ATTENDANCE_BASE_URL = 'https://api.flashapp.services/time-and-attendance/v1/';

const pick = (object, paths) => {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => current?.[key], object);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
};
const asArray = (value) => Array.isArray(value) ? value : [];

async function parseFlashJson(response, url) {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (cause) {
    const error = new Error(`Flash API retornou JSON inválido em ${url.pathname}.`, { cause });
    error.code = 'FLASH_INVALID_JSON';
    error.status = response.status;
    error.endpoint = `${url.origin}${url.pathname}`;
    throw error;
  }
}

async function flashGet(baseUrl, path, query = {}) {
  const apiKey = process.env.FLASH_API_KEY;
  if (!apiKey) throw new Error('FLASH_API_KEY não configurada.');

  const url = new URL(String(path).replace(/^\/+/, ''), baseUrl);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    headers: {
      'x-flash-auth': apiKey,
      Accept: 'application/json',
    },
  });

  const payload = await parseFlashJson(response, url);

  if (!response.ok) {
    const error = new Error(payload?.message || `Flash API respondeu ${response.status}`);
    error.code = 'FLASH_HTTP_ERROR';
    error.status = response.status;
    error.endpoint = `${url.origin}${url.pathname}`;
    error.requestId = payload?.request_id || payload?.requestId || null;
    throw error;
  }

  return payload;
}

function validateCoreEmployee(employee, companyId) {
  if (!employee || typeof employee !== 'object' || Array.isArray(employee) ||
      typeof employee.id !== 'string' || !employee.id.trim() ||
      typeof employee.name !== 'string' || !employee.name.trim()) {
    const error = new Error(`Flash Core retornou colaborador sem id ou name válido (empresa=${companyId}).`);
    error.code = 'FLASH_CORE_EMPLOYEE_INVALID';
    throw error;
  }
  // O identificador de empresa é validado quando disponibilizado pelo Core.
  if (employee.companyId && String(employee.companyId) !== String(companyId)) {
    const error = new Error(`Flash Core retornou colaborador de outra empresa (empresa solicitada=${companyId}, empresa retornada=${employee.companyId}, employeeId=${employee.id}).`);
    error.code = 'FLASH_CORE_EMPLOYEE_COMPANY_MISMATCH';
    throw error;
  }
  return employee;
}

export async function getEmployeeById(companyId, employeeId) {
  if (!employeeId || typeof employeeId !== 'string') throw new Error('employeeId obrigatório para consulta individual no Flash Core.');
  // Endpoint oficial de detalhe: acionado apenas para IDs ausentes da listagem já sincronizada.
  const employee = await flashGet(FLASH_CORE_BASE_URL, `employees/${encodeURIComponent(employeeId)}`);
  const validated = validateCoreEmployee(employee, companyId);
  if (validated.id !== employeeId) {
    const error = new Error(`Flash Core retornou ID divergente para colaborador ${employeeId} (empresa=${companyId}).`);
    error.code = 'FLASH_CORE_EMPLOYEE_ID_MISMATCH';
    throw error;
  }
  return validated;
}

export async function listEmployees(companyId) {
  const records = [];
  const seen = new Set();
  const limit = 100;
  for (let page = 1; page <= 100; page += 1) {
    const payload = await flashGet(FLASH_CORE_BASE_URL, 'employees', { page, limit, companyId });
    if (!Array.isArray(payload?.records)) {
      const error = new Error(`Flash Core retornou lista de funcionários sem records[] (empresa=${companyId}, página=${page}).`);
      error.code = 'FLASH_CORE_EMPLOYEE_RESPONSE_INVALID';
      throw error;
    }
    const current = payload.records;
    for (const value of current) {
      const employee = validateCoreEmployee(value, companyId);
      if (seen.has(employee.id)) {
        const error = new Error(`Flash Core repetiu employeeId ${employee.id} na paginação (empresa=${companyId}, página=${page}).`);
        error.code = 'FLASH_CORE_EMPLOYEE_DUPLICATE';
        throw error;
      }
      seen.add(employee.id);
      records.push(employee);
    }
    const rawTotalPages = pick(payload, ['metadata.totalPages', 'metadata.pages']);
    const totalPages = rawTotalPages === null ? null : Number(rawTotalPages);
    if (totalPages !== null && (!Number.isInteger(totalPages) || totalPages < page)) {
      const error = new Error(`Paginação inconsistente no Flash Core (empresa=${companyId}, página=${page}, totalPages=${rawTotalPages}).`);
      error.code = 'FLASH_CORE_PAGINATION_INVALID';
      throw error;
    }
    if (totalPages !== null ? page >= totalPages : current.length < limit) return records;
    if (current.length === 0) {
      const error = new Error(`Flash Core retornou página vazia antes do fim (empresa=${companyId}, página=${page}, totalPages=${totalPages}).`);
      error.code = 'FLASH_CORE_PAGINATION_INVALID';
      throw error;
    }
  }
  const error = new Error(`Flash Core excedeu 100 páginas de funcionários na empresa ${companyId}; sincronização interrompida para não gravar cadastro incompleto.`);
  error.code = 'FLASH_CORE_PAGINATION_LIMIT';
  throw error;
}

export async function listDepartments(companyId) {
  const payload = await flashGet(FLASH_CORE_BASE_URL, 'departments', { companyId });
  if (Array.isArray(payload)) return payload;
  return asArray(payload?.records || payload?.data);
}

export async function listTimetableAllocations(companyId, startDate, endDate, employeeId = null) {
  const payload = await flashGet(FLASH_ATTENDANCE_BASE_URL, 'timetables/allocations', {
    companyId,
    startDate: `${startDate}T00:00:00.000Z`,
    endDate: `${endDate}T23:59:59.999Z`,
    employeeId,
  });
  return asArray(payload?.data);
}

export async function listAttendanceDay(companyId, date) {
  const payload = await flashGet(FLASH_ATTENDANCE_BASE_URL, 'attendance/day', { companyId, date });
  if (!Array.isArray(payload?.data)) {
    const error = new Error(`Flash retornou resposta de marcações sem data[] (empresa=${companyId}, data=${date}).`);
    error.code = 'FLASH_ATTENDANCE_RESPONSE_INVALID';
    throw error;
  }
  return payload.data;
}

export function dateRange(startDate, endDate) {
  const result = [];
  const cursor = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function parseTimetableName(value) {
  const raw = String(value || '');
  const times = (raw.match(/(?:[01]?\d|2[0-3]):[0-5]\d/g) || []).map((time) => {
    const [hour, minute] = time.split(':');
    return `${hour.padStart(2, '0')}:${minute}`;
  });

  return {
    times,
    entry: times[0] || null,
    breakStart: times.length >= 4 ? times[1] : null,
    breakEnd: times.length >= 4 ? times[times.length - 2] : null,
    exit: times.length >= 2 ? times[times.length - 1] : null,
  };
}

const normalizeClock = (value, field = null) => {
  if (value === null || value === undefined || value === '') return null;
  return normalizeFlashTemporal(value, { field }).time;
};

const MARK_TIME_FIELDS = [
  'occurredAt',
  'clockedAt',
  'dateTime',
  'datetime',
  'timestamp',
  'markedAt',
  'attendanceAt',
  'punchAt',
  'time',
  'hour',
  'value',
];

function extractMarkTime(mark) {
  if (typeof mark === 'string' || typeof mark === 'number' || mark instanceof Date) {
    return normalizeFlashTemporal(mark, { field: 'mark' });
  }
  if (!mark || typeof mark !== 'object') return null;

  for (const field of MARK_TIME_FIELDS) {
    const value = mark[field];
    if (value === undefined || value === null || value === '') continue;
    return { ...normalizeFlashTemporal(value, { field }), field };
  }

  return null;
}

function findMarkArrays(value, depth = 0, result = [], seen = new Set()) {
  if (!value || depth > 5) return result;
  if (Array.isArray(value)) {
    value.forEach((item) => findMarkArrays(item, depth + 1, result, seen));
    return result;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      const normalizedKey = key.toLowerCase();
      if (/(schedule|timetable|contract|shift|scale|escala)/.test(normalizedKey)) return;
      if (
        Array.isArray(child)
        && /(punch|mark|attendance|clock|entr|batida|record|time)/.test(normalizedKey)
        && !seen.has(child)
      ) {
        seen.add(child);
        result.push(child);
      }
      findMarkArrays(child, depth + 1, result, seen);
    });
  }
  return result;
}

function isAdjusted(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 3) return false;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (/(adjust|edit|manual|changed|alterad)/.test(normalized) && child === true) return true;
    if (typeof child === 'string' && /(adjust|manual|editad)/i.test(child) && /(type|status|source|origin)/.test(normalized)) return true;
    if (child && typeof child === 'object' && isAdjusted(child, depth + 1)) return true;
  }
  return false;
}

function collectPunches(items, day) {
  const values = [];
  const addPunch = (temporal, adjusted) => {
    if (!temporal) return;
    values.push({
      time: temporal.time,
      localDate: temporal.localDate || day,
      adjusted,
      sourceKind: temporal.kind,
      sourceField: temporal.field || null,
    });
  };

  items.forEach((item) => {
    addPunch(extractMarkTime(item), isAdjusted(item));
    findMarkArrays(item).forEach((array) => array.forEach((mark) => {
      addPunch(extractMarkTime(mark), isAdjusted(mark) || isAdjusted(item));
    }));
  });

  const unique = new Map();
  values.forEach((value) => {
    const key = `${value.localDate}T${value.time}`;
    const previous = unique.get(key);
    unique.set(key, {
      ...previous,
      ...value,
      adjusted: value.adjusted || previous?.adjusted || false,
    });
  });

  return [...unique.values()].sort((a, b) => (
    `${a.localDate}T${a.time}`.localeCompare(`${b.localDate}T${b.time}`)
  ));
}

const timeToSeconds = (time) => {
  if (!time) return null;
  const [hour, minute, second = '0'] = String(time).split(':');
  const h = Number(hour);
  const m = Number(minute);
  const s = Number(second);
  if (![h, m, s].every(Number.isFinite)) return null;
  return h * 3600 + m * 60 + s;
};

function collectScheduleTimes(value, depth = 0, result = []) {
  if (value === null || value === undefined || depth > 6) return result;
  if (typeof value === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(value)) {
      (value.match(/(?:[01]?\d|2[0-3]):[0-5]\d/g) || []).forEach((match) => result.push(match.padStart(5, '0')));
    }
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectScheduleTimes(item, depth + 1, result));
    return result;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      if (/^(startDate|endDate|createdAt|updatedAt|allocationStartDate|allocation_start_date)$/i.test(key)) return;
      collectScheduleTimes(child, depth + 1, result);
    });
  }
  return result;
}

function expectedTimesFromValue(value, allowRecursive = true) {
  const explicitEntry = normalizeClock(
    pick(value, ['scheduledEntry', 'scheduled_entry', 'expectedEntry', 'entryTime', 'startTime', 'workStart']),
    'scheduledEntry',
  );
  const explicitExit = normalizeClock(
    pick(value, ['scheduledExit', 'scheduled_exit', 'expectedExit', 'exitTime', 'endTime', 'workEnd']),
    'scheduledExit',
  );
  if (explicitEntry || explicitExit || !allowRecursive) return { entry: explicitEntry, exit: explicitExit };
  const times = [...new Set(collectScheduleTimes(value))].filter(Boolean).sort((a, b) => timeToSeconds(a) - timeToSeconds(b));
  return { entry: times[0] || null, exit: times[times.length - 1] || null };
}

function employeeIdentity(value) {
  return {
    id: String(pick(value, ['employeeId', 'flash_employee_id', 'employee.id', 'employee.employeeId', 'collaboratorId', 'personId']) || ''),
    externalId: String(pick(value, ['externalId', 'external_id', 'employee.externalId']) || ''),
  };
}

function allocationStart(allocation) {
  return String(pick(allocation, ['allocationStartDate', 'allocation_start_date', 'startDate', 'validFrom', 'allocationStart']) || '').slice(0, 10);
}

function allocationMatches(allocation, employee, day) {
  const identity = employeeIdentity(allocation);
  if (identity.id && identity.id !== employee.id) return false;
  if (!identity.id && identity.externalId && identity.externalId !== employee.externalId) return false;
  const start = allocationStart(allocation);
  const end = String(pick(allocation, ['endDate', 'validTo', 'allocationEnd', 'allocation_end_date']) || '').slice(0, 10);
  if (start && day < start) return false;
  if (end && day > end) return false;
  return Boolean(identity.id || identity.externalId);
}

function findAllocation(allocations, employee, day) {
  return allocations
    .filter((candidate) => allocationMatches(candidate, employee, day))
    .sort((a, b) => allocationStart(b).localeCompare(allocationStart(a)))[0] || null;
}

function evaluateStatus(expected, actual, settings, { exit = false, adjusted = false } = {}) {
  if (!actual || !expected) return null;
  if (adjusted) return 'adjusted';

  const expectedSeconds = timeToSeconds(expected);
  const actualSeconds = timeToSeconds(actual);
  if (expectedSeconds === null || actualSeconds === null) return null;

  const diffSeconds = actualSeconds - expectedSeconds;
  const beforeMinutes = Math.max(0, Number(settings.early_tolerance ?? 5) || 0);
  const afterMinutes = Math.max(0, Number(settings.late_tolerance ?? 5) || 0);
  const beforeLimitSeconds = beforeMinutes * 60;
  const afterLimitExclusiveSeconds = (afterMinutes + 1) * 60;

  if (diffSeconds < -beforeLimitSeconds) return 'early';
  if (diffSeconds >= afterLimitExclusiveSeconds) return exit ? 'late_exit' : 'late';
  return 'on_time';
}

function sanitizeAttendance(items) {
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const { documentNumber, pis, ...safe } = item;
    return safe;
  });
}

function withTimeNormalizationContext(error, { companyId, employeeId, externalId, day }) {
  if (!(error instanceof TimeNormalizationError)) return error;
  const employeeRef = employeeId || externalId || 'sem-identificador';
  const wrapped = new Error(
    `Falha ao normalizar horário da Flash para America/Fortaleza (empresa=${companyId}, colaborador=${employeeRef}, data=${day}, campo=${error.field || 'desconhecido'}, valor=${error.inputPreview || 'nulo'}). ${error.message}`,
    { cause: error },
  );
  wrapped.code = error.code;
  wrapped.field = error.field;
  wrapped.inputType = error.inputType;
  return wrapped;
}

export function normalizeAttendanceDay({ day, attendance, employees, allocations, settings, companyId, userId, importRunId, directory }) {
  const employeeDirectory = directory || createEmployeeDirectory(employees, companyId);
  const grouped = new Map();
  attendance.forEach((item) => {
    const identity = attendanceIdentity(item);
    const employee = employeeDirectory.resolve(identity);
    if (!employee) {
      throw new EmployeeIdentityError(
        'FLASH_ATTENDANCE_EMPLOYEE_NOT_FOUND',
        `Marcação sem cadastro Core correspondente (empresa=${companyId}, data=${day}, employeeId=${identity.id || 'ausente'}, externalId=${identity.externalId || 'ausente'}).`,
        { companyId, day, employeeId: identity.id, externalId: identity.externalId },
      );
    }
    const employeeId = identifier(employee.flash_employee_id);
    if (!grouped.has(employeeId)) grouped.set(employeeId, {
      employeeId,
      externalId: identifier(employee.external_id),
      employee,
      items: [],
    });
    grouped.get(employeeId).items.push(item);
  });

  return [...grouped.values()].map((group) => {
    const employee = group.employee;
    let punches;
    let attendanceExpected;
    try {
      punches = collectPunches(group.items, day);
      attendanceExpected = expectedTimesFromValue(group.items[0], false);
    } catch (error) {
      throw withTimeNormalizationContext(error, {
        companyId,
        employeeId: group.employeeId,
        externalId: group.externalId,
        day,
      });
    }

    const first = punches[0] || null;
    const last = punches.length >= 2 && punches.length % 2 === 0 ? punches[punches.length - 1] : null;
    const allocation = findAllocation(allocations, {
      id: group.employeeId || String(employee.id || employee.flash_employee_id || ''),
      externalId: group.externalId || String(employee.externalId || employee.external_id || ''),
    }, day);

    let allocationExpected;
    try {
      allocationExpected = expectedTimesFromValue(allocation || {}, true);
    } catch (error) {
      throw withTimeNormalizationContext(error, {
        companyId,
        employeeId: group.employeeId,
        externalId: group.externalId,
        day,
      });
    }

    const scheduledEntry = attendanceExpected.entry || allocationExpected.entry;
    const scheduledExit = attendanceExpected.exit || allocationExpected.exit;
    const actualEntry = first?.time || null;
    const actualExit = last?.time || null;
    const employeeName = employee.employee_name;
    const department = pick(employee, ['departments.0.name', 'department.name', 'department', 'department_name']) || pick(group.items[0], ['departmentName', 'department.name', 'department']) || null;
    const stableEmployeeId = group.employeeId;

    return {
      user_id: userId,
      import_run_id: importRunId,
      source_key: `${companyId}:${stableEmployeeId}:${day}`,
      flash_employee_id: group.employeeId || null,
      employee_name: employeeName,
      department,
      work_date: day,
      scheduled_entry: scheduledEntry,
      scheduled_exit: scheduledExit,
      actual_entry: actualEntry,
      actual_exit: actualExit,
      entry_status: evaluateStatus(scheduledEntry, actualEntry, settings, { adjusted: first?.adjusted }),
      exit_status: evaluateStatus(scheduledExit, actualExit, settings, { exit: true, adjusted: last?.adjusted }),
      raw_payload: { attendance: sanitizeAttendance(group.items), allocation: allocation || null },
      imported_at: new Date().toISOString(),
    };
  });
}
