export const FLASH_COMPANY_DEFINITIONS = [
  {
    key: 'clinica_new_odonto',
    name: 'CLINICA NEW ODONTO',
    cnpj: '12215750000160',
    env: 'FLASH_COMPANY_ID_CLINICA_NEW_ODONTO',
  },
  {
    key: 'clinica_new_odonto_aguanambi',
    name: 'CLINICA NEW ODONTO - AGUANAMBI',
    cnpj: '12215750000917',
    env: 'FLASH_COMPANY_ID_CLINICA_NEW_ODONTO_AGUANAMBI',
  },
  {
    key: 'clinica_new_odonto_bezerra',
    name: 'CLINICA NEW ODONTO - BEZERRA DE MENEZES',
    cnpj: '12215750000240',
    env: 'FLASH_COMPANY_ID_CLINICA_NEW_ODONTO_BEZERRA',
  },
  {
    key: 'clinica_new_odonto_sobral',
    name: 'CLINICA NEW ODONTO - SOBRAL',
    cnpj: '12215750000836',
    env: 'FLASH_COMPANY_ID_CLINICA_NEW_ODONTO_SOBRAL',
  },
  {
    key: 'new_odontologia',
    name: 'NEW ODONTOLOGIA',
    cnpj: '43082511000102',
    env: 'FLASH_COMPANY_ID_NEW_ODONTOLOGIA',
  },
  {
    key: 'new_rt',
    name: 'NEW RT',
    cnpj: '35248065000135',
    env: 'FLASH_COMPANY_ID_NEW_RT',
  },
  {
    key: 'odontoart',
    name: 'ODONTOART',
    cnpj: null,
    env: 'FLASH_COMPANY_ID_ODONTOART',
    legacyEnv: 'FLASH_COMPANY_ID',
  },
  {
    key: 'rt_servicos',
    name: 'RT SERVICOS',
    cnpj: '09674404000135',
    env: 'FLASH_COMPANY_ID_RT_SERVICOS',
  },
  {
    key: 'rt_servicos_filial',
    name: 'RT SERVICOS FILIAL',
    cnpj: '09674404000216',
    env: 'FLASH_COMPANY_ID_RT_SERVICOS_FILIAL',
  },
];

export function getFlashCompanies() {
  return FLASH_COMPANY_DEFINITIONS.map((definition) => {
    const id = process.env[definition.env] || (definition.legacyEnv ? process.env[definition.legacyEnv] : null) || null;
    return { ...definition, id };
  });
}

export function getConfiguredFlashCompanies() {
  return getFlashCompanies().filter((company) => company.id);
}

export function getMissingFlashCompanies() {
  return getFlashCompanies().filter((company) => !company.id);
}

export function assertConfiguredFlashCompanies() {
  const configured = getConfiguredFlashCompanies();
  if (!configured.length) {
    throw new Error('Nenhum FLASH_COMPANY_ID_* foi configurado no backend.');
  }
  return configured;
}
