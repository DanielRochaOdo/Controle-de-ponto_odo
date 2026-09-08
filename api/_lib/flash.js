const FLASH_BASE_URL = 'https://api.flashapp.services';
const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || 'America/Fortaleza';

const pick = (object, paths) => {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => current?.[key], object);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
};

const asArray = (value) => Array.isArray(value) ? value : [];

async function flashGet(path, query = {}) {
  const apiKey = process.env.FLASH_API_KEY;
  if (!apiKey) throw new Error('FLASH_API_KEY não configurada.');

  const url = new URL(path, FLASH_BASE_URL);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    headers: { 'x-flash-auth': apiKey, Accept: 'application/json' },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || `Flash API respondeu ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export async function listEmployees(companyId) {
  const records = [];
  let page = 1;
  const limit = 100;

  while (page <= 100) {
    const payload = await flashGet('/core/v1/employees', { page, limit, companyId });
    const current = asArray(payload?.records);
    records.push(...current);

    const totalPages = Number(pick(payload, ['metadata.totalPages', 'metadata.pages'])) || null;
    if ((totalPages && page >= totalPages) || current.length < limit) break;
    page += 1;
  }

  return records;
}

export async function listTimetableAllocations(companyId, startDate, endDate) {
  const payload = await flashGet('/time-and-attendance/v1/timetables/allocations', {
    companyId,
    startDate: `${startDate}T00:00:00.000Z`,
    endDate: `${endDate}T23:59:59.999Z`,
  });
  return asArray(payload?.data);
}

export async function listAttendanceDay(companyId, date) {
  const payload = await flashGet('/time-and-attendance/v1/attendance/day', { companyId, date });
  return asArray(payload?.data);
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

const normalizeClock = (value, day) => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();

  const clockMatch = raw.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:$|\s)/);
  if (clockMatch && !raw.includes('T')) {
    return `${clockMatch[1].padStart(2, '0')}:${clockMatch[2]}`;
  }

  if (/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.test(raw)) {
    const [hour, minute] = raw.split(':');
    return `${hour.padStart(2, '0')}:${minute}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: DEFAULT_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(parsed);
    const hour = parts.find((part) => part.type === 'hour')?.value;
    const minute = parts.find((part) => part.type === 'minute')?.value;
    if (hour && minute) return `${hour}:${minute}`;
  }

  if (day) {
    const match = raw.match(/([01]?\d|2[0-3]):([0-5]\d)/);
    if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
  }
  return null;
};

const markKeys = [
  'occurredAt', 'clockedAt', 'dateTime', 'datetime', 'timestamp', 'markedAt',
  'attendanceAt', 'punchAt', 'time', 'hour', 'value', 'createdAt',
];

function extractMarkTime(mark, day) {
  if (typeof mark === 'string' || typeof mark === 'number') return normalizeClock(mark, day);
  if (!mark || typeof mark !== 'object') return null;
  const value = pick(mark, markKeys);
  return normalizeClock(value, day);
}

function findMarkArrays(value, depth = 0, result = []) {
  if (!value || depth > 5) return result;
  if (Array.isArray(value)) {
    if (value.some((item) => extractMarkTime(item))) result.push(value);
    value.forEach((item) => findMarkArrays(item, depth + 1, result));
    return result;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      const normalizedKey = key.toLowerCase();
      if (Array.isArray(child) && /(punch|mark|attendance|clock|entr|batida|record|time)/.test(normalizedKey)) {
        result.push(child);
      }
      findMarkArrays(child, depth + 1, result);
    });
  }
  return result;
}

function collectPunches(items, day) {
  const values = [];
  items.forEach((item) => {
    const ownTime = extractMarkTime(item, day);
    if (ownTime) values.push({ time: ownTime, adjusted: isAdjusted(item) });

    findMarkArrays(item).forEach((array) => {
      array.forEach((mark) => {
        const time = extractMarkTime(mark, day);
        if (time) values.push({ time, adjusted: isAdjusted(mark) || isAdjusted(item) });
      });
    });
  });

  const unique = new Map();
  values.forEach((value) => unique.set(`${value.time}:${value.adjusted}`, value));
  return [...unique.values()].sort((a, b) => a.time.localeCompare(b.time));
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

const timeToMinutes = (time) => {
  if (!time) return null;
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
};

function collectScheduleTimes(value, depth = 0, result = []) {
  if (value === null || value === undefined || depth > 6) return result;
  if (typeof value === 'string') {
    if (!value.includes('T')) {
      const matches = value.match(/(?:[01]?\d|2[0-3]):[0-5]\d/g) || [];
      matches.forEach((match) => result.push(match.padStart(5, '0')));
    }
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectScheduleTimes(item, depth + 1, result));
    return result;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      if (/^(startDate|endDate|createdAt|updatedAt)$/i.test(key)) return;
      collectScheduleTimes(child, depth + 1, result);
    });
  }
  return result;
}

function expectedTimesFromValue(value) {
  const explicitEntry = normalizeClock(pick(value, ['scheduledEntry', 'expectedEntry', 'entryTime', 'startTime', 'workStart']), null);
  const explicitExit = normalizeClock(pick(value, ['scheduledExit', 'expectedExit', 'exitTime', 'endTime', 'workEnd']), null);
  if (explicitEntry || explicitExit) return { entry: explicitEntry, exit: explicitExit };

  const times = [...new Set(collectScheduleTimes(value))]
    .filter(Boolean)
    .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  return { entry: times[0] || null, exit: times[times.length - 1] || null };
}

function employeeIdentity(value) {
  return {
    id: String(pick(value, ['employeeId', 'employee.id', 'employee.employeeId', 'id']) || ''),
    externalId: String(pick(value, ['externalId', 'employee.externalId']) || ''),
  };
}

function allocationMatches(allocation, employee, day) {
  const identity = employeeIdentity(allocation);
  if (identity.id && identity.id !== employee.id) return false;
  if (!identity.id && identity.externalId && identity.externalId !== employee.externalId) return false;

  const start = String(pick(allocation, ['startDate', 'validFrom', 'allocationStart']) || '').slice(0, 10);
  const end = String(pick(allocation, ['endDate', 'validTo', 'allocationEnd']) || '').slice(0, 10);
  if (start && day < start) return false;
  if (end && day > end) return false;
  return Boolean(identity.id || identity.externalId);
}

function evaluateStatus(expected, actual, settings, { exit = false, adjusted = false } = {}) {
  if (!actual || !expected) return null;
  if (adjusted) return 'adjusted';

  const diff = timeToMinutes(actual) - timeToMinutes(expected);
  const onTime = Number(settings.on_time_tolerance ?? 5);
  const early = Number(settings.early_tolerance ?? 5);
  const late = Number(exit ? settings.late_exit_tolerance ?? 5 : settings.late_tolerance ?? 5);

  if (Math.abs(diff) <= onTime) return 'on_time';
  if (diff < -early) return 'early';
  if (diff > late) return exit ? 'late_exit' : 'late';
  return 'on_time';
}

export function normalizeAttendanceDay({ day, attendance, employees, allocations, settings, companyId, userId, importRunId }) {
  const employeeById = new Map();
  const employeeByExternalId = new Map();
  employees.forEach((employee) => {
    if (employee?.id) employeeById.set(String(employee.id), employee);
    if (employee?.externalId) employeeByExternalId.set(String(employee.externalId), employee);
  });

  const grouped = new Map();
  attendance.forEach((item, index) => {
    const identity = employeeIdentity(item);
    const employee = employeeById.get(identity.id) || employeeByExternalId.get(identity.externalId);
    const employeeId = identity.id || String(employee?.id || '');
    const externalId = identity.externalId || String(employee?.externalId || '');
    const fallbackName = String(pick(item, ['employeeName', 'employee.name', 'name']) || employee?.name || `Colaborador ${index + 1}`);
    const key = employeeId || externalId || fallbackName;
    if (!grouped.has(key)) grouped.set(key, { employeeId, externalId, employee, items: [], fallbackName });
    grouped.get(key).items.push(item);
  });

  return [...grouped.values()].map((group) => {
    const employee = group.employee || {};
    const punches = collectPunches(group.items, day);
    const first = punches[0] || null;
    const last = punches.length > 1 ? punches[punches.length - 1] : null;

    const attendanceExpected = expectedTimesFromValue(group.items[0]);
    const allocation = allocations.find((candidate) => allocationMatches(candidate, {
      id: group.employeeId || String(employee.id || ''),
      externalId: group.externalId || String(employee.externalId || ''),
    }, day));
    const allocationExpected = expectedTimesFromValue(allocation || {});

    const scheduledEntry = attendanceExpected.entry || allocationExpected.entry;
    const scheduledExit = attendanceExpected.exit || allocationExpected.exit;
    const actualEntry = first?.time || null;
    const actualExit = last?.time || null;

    const employeeName = employee.name || group.fallbackName;
    const department = pick(employee, ['departments.0.name', 'department.name', 'department']) || pick(group.items[0], ['departmentName', 'department.name', 'department']) || null;
    const stableEmployeeId = group.employeeId || group.externalId || employeeName;

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
      raw_payload: { attendance: group.items, allocation: allocation || null },
      imported_at: new Date().toISOString(),
    };
  });
}
