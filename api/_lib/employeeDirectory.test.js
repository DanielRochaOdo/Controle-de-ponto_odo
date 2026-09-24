import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceIdentity,
  createEmployeeDirectory,
  EmployeeIdentityError,
  missingAttendanceEmployees,
} from './employeeDirectory.js';
import { normalizeAttendanceDay } from './flash.js';

const companyId = 'empresa-A';
const employees = [
  { flash_employee_id: 'core-1', external_id: 'mat-1', employee_name: 'Nome obtido do Core', department_name: 'ADM' },
  { flash_employee_id: 'core-2', external_id: 'mat-2', employee_name: 'Outra pessoa', department_name: 'RH' },
];

test('associa por employeeId sem inventar nomes', () => {
  const directory = createEmployeeDirectory(employees, companyId);
  assert.equal(directory.resolve(attendanceIdentity({ employeeId: 'core-1' })).employee_name, 'Nome obtido do Core');
});

test('associa por externalId quando a marcação não traz employeeId', () => {
  const directory = createEmployeeDirectory(employees, companyId);
  assert.equal(directory.resolve(attendanceIdentity({ externalId: 'mat-1' })).flash_employee_id, 'core-1');
});

test('identificadores conflitantes não geram associação incorreta', () => {
  const directory = createEmployeeDirectory(employees, companyId);
  assert.throws(
    () => directory.resolve(attendanceIdentity({ employeeId: 'core-1', externalId: 'mat-2' })),
    (error) => error instanceof EmployeeIdentityError && error.code === 'FLASH_ATTENDANCE_IDENTITY_CONFLICT',
  );
});

test('listagem Core não aceita nome artificial ou ID sem nome', () => {
  assert.throws(
    () => createEmployeeDirectory([{ flash_employee_id: 'x', employee_name: 'Colaborador x' }], companyId),
    (error) => error.code === 'FLASH_CORE_EMPLOYEE_INVALID',
  );
  assert.throws(
    () => createEmployeeDirectory([{ flash_employee_id: 'x', employee_name: '' }], companyId),
    (error) => error.code === 'FLASH_CORE_EMPLOYEE_INVALID',
  );
});

test('identifica IDs ausentes no catálogo por empresa e dia', () => {
  const directory = createEmployeeDirectory(employees, companyId);
  assert.deepEqual(
    missingAttendanceEmployees([
      { day: '2026-09-24', attendance: [{ employeeId: 'core-1' }, { employeeId: 'missing' }] },
      { day: '2026-09-25', attendance: [{ employeeId: 'missing' }] },
    ], directory),
    [{ id: 'missing', externalId: '', day: '2026-09-24' }],
  );
});

test('marcação sem identidade é rejeitada', () => {
  assert.throws(
    () => attendanceIdentity({ punch: '08:00' }),
    (error) => error.code === 'FLASH_ATTENDANCE_IDENTITY_MISSING',
  );
});

const params = (attendance, directory) => ({
  day: '2026-09-24',
  companyId,
  userId: 'user-A',
  importRunId: 'run-A',
  attendance,
  employees,
  directory,
  allocations: [],
  settings: {},
});

test('normalização utiliza sempre nome, departamento e ID canônico do Core', () => {
  const directory = createEmployeeDirectory(employees, companyId);
  const rows = normalizeAttendanceDay(params([
    { externalId: 'mat-1', time: '08:00:00' },
    { externalId: 'mat-1', time: '17:00:00' },
  ], directory));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employee_name, 'Nome obtido do Core');
  assert.equal(rows[0].department, 'ADM');
  assert.equal(rows[0].flash_employee_id, 'core-1');
  assert.equal(rows[0].source_key, 'empresa-A:core-1:2026-09-24');
});

test('sem cadastro Core não grava Colaborador + ID', () => {
  const directory = createEmployeeDirectory(employees, companyId);
  assert.throws(
    () => normalizeAttendanceDay(params([{ employeeId: 'desconhecido', time: '08:00:00' }], directory)),
    (error) => error.code === 'FLASH_ATTENDANCE_EMPLOYEE_NOT_FOUND',
  );
});
