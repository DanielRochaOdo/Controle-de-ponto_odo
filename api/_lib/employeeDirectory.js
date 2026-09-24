/**
 * Identidade de colaboradores no contrato Flash.
 * employeeId é o ID interno Core; externalId é um identificador secundário.
 * Nome somente da resposta validada do Core, nunca inferido da marcação.
 */
export class EmployeeIdentityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EmployeeIdentityError';
    this.code = code;
    this.details = details;
  }
}

export const identifier = (value) =>
  value === null || value === undefined ? '' : String(value).trim();

export function attendanceIdentity(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new EmployeeIdentityError('FLASH_ATTENDANCE_IDENTITY_INVALID', 'Marcação não contém um objeto de colaborador válido.');
  }
  const id = identifier(item.employeeId);
  const externalId = identifier(item.externalId);
  if (!id && !externalId) {
    throw new EmployeeIdentityError(
      'FLASH_ATTENDANCE_IDENTITY_MISSING',
      'Marcação sem employeeId e externalId; não é possível associá-la a um colaborador.',
    );
  }
  return { id, externalId };
}

export function createEmployeeDirectory(employees, companyId) {
  const byId = new Map();
  const byExternal = new Map();
  for (const employee of employees) {
    const id = identifier(employee.flash_employee_id);
    const externalId = identifier(employee.external_id);
    const name = identifier(employee.employee_name);
    if (!id || !name || /^Colaborador\s+\S+$/i.test(name)) {
      throw new EmployeeIdentityError(
        'FLASH_CORE_EMPLOYEE_INVALID',
        `Cadastro Core inválido na empresa ${companyId}: ID e nome verdadeiro são obrigatórios.`,
        { employeeId: id || null },
      );
    }
    if (byId.has(id) && byId.get(id).employee_name !== name) {
      throw new EmployeeIdentityError(
        'FLASH_CORE_EMPLOYEE_CONFLICT',
        `IDs duplicados com nomes diferentes na empresa ${companyId}.`,
        { employeeId: id },
      );
    }
    byId.set(id, employee);
    if (externalId) {
      const existing = byExternal.get(externalId);
      if (existing && identifier(existing.flash_employee_id) !== id) {
        throw new EmployeeIdentityError(
          'FLASH_CORE_EXTERNAL_ID_CONFLICT',
          `externalId associado a mais de um colaborador na empresa ${companyId}.`,
          { externalId },
        );
      }
      byExternal.set(externalId, employee);
    }
  }

  const resolve = (identity) => {
    const fromId = identity.id ? byId.get(identity.id) : null;
    const fromExternal = identity.externalId ? byExternal.get(identity.externalId) : null;
    if (fromId && fromExternal && identifier(fromId.flash_employee_id) !== identifier(fromExternal.flash_employee_id)) {
      throw new EmployeeIdentityError(
        'FLASH_ATTENDANCE_IDENTITY_CONFLICT',
        `employeeId e externalId da marcação indicam colaboradores diferentes na empresa ${companyId}.`,
        { employeeId: identity.id, externalId: identity.externalId },
      );
    }
    const employee = fromId || fromExternal || null;
    // Um ID de funcionário divergente não pode ser associado silenciosamente por externalId.
    if (employee && identity.id && identifier(employee.flash_employee_id) !== identity.id) {
      throw new EmployeeIdentityError(
        'FLASH_ATTENDANCE_IDENTITY_CONFLICT',
        `employeeId da marcação não corresponde ao cadastro Core encontrado pelo externalId na empresa ${companyId}.`,
        { employeeId: identity.id, externalId: identity.externalId },
      );
    }
    if (employee && identity.externalId && identifier(employee.external_id) &&
        identifier(employee.external_id) !== identity.externalId) {
      throw new EmployeeIdentityError(
        'FLASH_ATTENDANCE_IDENTITY_CONFLICT',
        `externalId da marcação diverge do cadastro Core na empresa ${companyId}.`,
        { employeeId: identity.id, externalId: identity.externalId },
      );
    }
    return employee;
  };

  return { resolve };
}

export function missingAttendanceEmployees(attendanceDays, directory) {
  const missing = new Map();
  for (const { day, attendance } of attendanceDays) {
    for (const item of attendance) {
      const identity = attendanceIdentity(item);
      const employee = directory.resolve(identity);
      if (!employee) {
        const key = identity.id ? `id:${identity.id}` : `external:${identity.externalId}`;
        if (!missing.has(key)) missing.set(key, { ...identity, day });
      }
    }
  }
  return [...missing.values()];
}
