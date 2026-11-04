import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileAttendanceEmployees } from '../import-attendance.js';
import { normalizeAttendanceDay } from './flash.js';

const company = { id: 'empresa-A', key: 'a', name: 'Empresa A', cnpj: null };
const dailyPayloads = [{
  day: '2026-09-24',
  attendance: [
    { employeeId: 'core-historico', time: '08:00:00' },
    { employeeId: 'core-historico', time: '17:00:00' },
  ],
}];

function fakeSupabase() {
  const stored = [];
  return {
    stored,
    from(table) {
      if (table === 'flash_departments') {
        return {
          select() {
            return { eq() { return { async eq() { return { data: [], error: null }; } }; } };
          },
        };
      }
      if (table === 'flash_employees') {
        return {
          async upsert(rows) {
            stored.push(...rows);
            return { error: null };
          },
        };
      }
      throw new Error(`Tabela inesperada: ${table}`);
    },
  };
}

test('marcações com ID histórico são reconciliadas uma única vez pelo detalhe oficial do Core', async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.FLASH_API_KEY;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({
      id: 'core-historico',
      name: 'Funcionária com nome no Core',
      companyId: company.id,
      externalId: 'mat-historica',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  process.env.FLASH_API_KEY = 'test-only';
  try {
    const supabase = fakeSupabase();
    const resolved = await reconcileAttendanceEmployees({
      company, userId: 'user-A', supabase, dailyPayloads, employees: [],
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0], 'https://api.flashapp.services/core/v1/employees/core-historico');
    assert.equal(resolved.recovered, 1);
    assert.equal(supabase.stored[0].employee_name, 'Funcionária com nome no Core');
    const rows = normalizeAttendanceDay({
      day: '2026-09-24',
      attendance: dailyPayloads[0].attendance,
      employees: resolved.employees,
      directory: resolved.directory,
      allocations: [],
      settings: {},
      companyId: company.id,
      userId: 'user-A',
      importRunId: 'run-A',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].employee_name, 'Funcionária com nome no Core');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.FLASH_API_KEY;
    else process.env.FLASH_API_KEY = oldKey;
  }
});

test('Core indisponível para ID histórico resulta em erro explícito sem cadastro fictício', async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.FLASH_API_KEY;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
  process.env.FLASH_API_KEY = 'test-only';
  try {
    const supabase = fakeSupabase();
    await assert.rejects(
      reconcileAttendanceEmployees({ company, userId: 'user-A', supabase, dailyPayloads, employees: [] }),
      (error) => error.code === 'FLASH_CORE_EMPLOYEE_UNRESOLVED' && /core-historico/.test(error.message),
    );
    assert.equal(supabase.stored.length, 0);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.FLASH_API_KEY;
    else process.env.FLASH_API_KEY = oldKey;
  }
});
