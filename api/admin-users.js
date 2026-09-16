import { createClient } from '@supabase/supabase-js';
import { getConfiguredFlashCompanies } from './_lib/flashCompanies.js';

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

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeName = (value) => String(value || '').trim();
const VALID_ROLES = new Set(['admin', 'manager']);
const normalizeRole = (value) => {
  const role = String(value || 'manager').trim().toLowerCase();
  return VALID_ROLES.has(role) ? role : null;
};

async function requireAdmin(req, res, supabase) {
  const token = getToken(req);
  if (!token) {
    res.status(401).json({ error: 'Não autenticado.' });
    return null;
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', authData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (profile?.role !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito a administradores.' });
    return null;
  }

  return authData.user;
}

async function listAllAuthUsers(supabase) {
  const users = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
}

async function loadAccessCatalog(supabase) {
  const companies = getConfiguredFlashCompanies();
  if (!companies.length) return [];

  const companyIds = companies.map((company) => company.id);
  const { data, error } = await supabase
    .from('flash_departments')
    .select('flash_company_id,flash_department_id,name,is_active,synced_at')
    .in('flash_company_id', companyIds)
    .order('name');
  if (error) throw error;

  const departmentsByCompany = new Map();
  (data || []).forEach((row) => {
    if (!row?.flash_company_id || !row?.flash_department_id || !row?.name || row.is_active === false) return;
    const companyId = String(row.flash_company_id);
    const departmentId = String(row.flash_department_id);
    if (!departmentsByCompany.has(companyId)) departmentsByCompany.set(companyId, new Map());
    departmentsByCompany.get(companyId).set(departmentId, {
      id: departmentId,
      name: String(row.name),
    });
  });

  return companies.map((company) => ({
    id: String(company.id),
    key: company.key,
    name: company.name,
    departments: [...(departmentsByCompany.get(String(company.id))?.values() || [])]
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  }));
}

function normalizeAccessEntries(access, catalog) {
  if (!Array.isArray(access)) return [];
  const companies = new Map(catalog.map((company) => [String(company.id), company]));
  const grouped = new Map();

  access.forEach((entry) => {
    const companyId = String(entry?.companyId || '').trim();
    const departmentKey = String(entry?.departmentKey || '').trim();
    if (!companyId || !departmentKey) return;

    const company = companies.get(companyId);
    if (!company) throw new Error('Uma das empresas selecionadas não está disponível na Estrutura Flash.');

    if (departmentKey !== '*' && !company.departments.some((department) => department.id === departmentKey)) {
      throw new Error(`Um dos departamentos selecionados de ${company.name} não está disponível na Estrutura Flash.`);
    }

    if (!grouped.has(companyId)) grouped.set(companyId, new Set());
    grouped.get(companyId).add(departmentKey);
  });

  const normalized = [];
  grouped.forEach((keys, companyId) => {
    if (keys.has('*')) {
      normalized.push({ companyId, departmentKey: '*' });
      return;
    }
    keys.forEach((departmentKey) => normalized.push({ companyId, departmentKey }));
  });
  return normalized;
}

async function replaceManagerAccess(supabase, userId, access, catalog) {
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) {
    const error = new Error('Usuário não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  if (profile.role !== 'manager') {
    const error = new Error('O escopo de empresas e departamentos é aplicado somente a managers.');
    error.statusCode = 400;
    throw error;
  }

  const normalized = normalizeAccessEntries(access, catalog);
  const { error: deleteError } = await supabase
    .from('manager_attendance_permissions')
    .delete()
    .eq('user_id', userId);
  if (deleteError) throw deleteError;

  if (normalized.length) {
    const { error: insertError } = await supabase
      .from('manager_attendance_permissions')
      .insert(normalized.map((entry) => ({
        user_id: userId,
        flash_company_id: entry.companyId,
        department_key: entry.departmentKey,
      })));
    if (insertError) throw insertError;
  }

  return normalized;
}

async function handleList(supabase, res) {
  const [authUsers, profilesResult, permissionsResult, accessCatalog] = await Promise.all([
    listAllAuthUsers(supabase),
    supabase.from('user_profiles').select('user_id,display_name,role'),
    supabase.from('manager_attendance_permissions').select('user_id,flash_company_id,department_key'),
    loadAccessCatalog(supabase),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (permissionsResult.error) throw permissionsResult.error;

  const profiles = new Map((profilesResult.data || []).map((profile) => [profile.user_id, profile]));
  const accessByUser = new Map();
  (permissionsResult.data || []).forEach((permission) => {
    if (!accessByUser.has(permission.user_id)) accessByUser.set(permission.user_id, []);
    accessByUser.get(permission.user_id).push({
      companyId: String(permission.flash_company_id),
      departmentKey: String(permission.department_key),
    });
  });

  const users = authUsers
    .map((user) => {
      const profile = profiles.get(user.id);
      return {
        id: user.id,
        name: user.user_metadata?.name || profile?.display_name || '',
        email: user.email || '',
        role: profile?.role || 'manager',
        access: accessByUser.get(user.id) || [],
        createdAt: user.created_at || null,
        lastSignInAt: user.last_sign_in_at || null,
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email, 'pt-BR'));

  return res.status(200).json({ users, accessCatalog });
}

async function handleCreate(req, supabase, res) {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const name = normalizeName(req.body?.name);
  const role = normalizeRole(req.body?.role);

  if (!email) return res.status(400).json({ error: 'E-mail é obrigatório.' });
  if (!password) return res.status(400).json({ error: 'Senha é obrigatória.' });
  if (!role) return res.status(400).json({ error: 'Perfil inválido. Use admin ou manager.' });

  const accessCatalog = role === 'manager' ? await loadAccessCatalog(supabase) : [];
  const normalizedAccess = role === 'manager'
    ? normalizeAccessEntries(req.body?.access || [], accessCatalog)
    : [];

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: name ? { name } : {},
  });

  if (error) return res.status(400).json({ error: error.message || 'Não foi possível criar o usuário.' });

  const createdUser = data?.user;
  if (!createdUser?.id) return res.status(500).json({ error: 'Usuário criado sem identificador.' });

  try {
    const displayName = name || email.split('@')[0] || 'Usuário';
    const { error: profileError } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: createdUser.id,
        display_name: displayName,
        role,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (profileError) throw profileError;

    if (role === 'manager') {
      await replaceManagerAccess(supabase, createdUser.id, normalizedAccess, accessCatalog);
    }

    return res.status(201).json({
      user: {
        id: createdUser.id,
        name: name || displayName,
        email,
        role,
        access: normalizedAccess,
        createdAt: createdUser.created_at || null,
        lastSignInAt: null,
      },
    });
  } catch (createError) {
    await supabase.auth.admin.deleteUser(createdUser.id).catch(() => null);
    throw createError;
  }
}

async function handlePasswordReset(req, supabase, res) {
  const userId = String(req.body?.userId || '').trim();
  const password = String(req.body?.password || '');

  if (!userId) return res.status(400).json({ error: 'Usuário é obrigatório.' });
  if (!password) return res.status(400).json({ error: 'Nova senha é obrigatória.' });

  const { data, error } = await supabase.auth.admin.updateUserById(userId, { password });
  if (error) return res.status(400).json({ error: error.message || 'Não foi possível alterar a senha.' });
  if (!data?.user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  return res.status(200).json({ success: true });
}

async function handleAccessUpdate(req, supabase, res) {
  const userId = String(req.body?.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'Usuário é obrigatório.' });

  const accessCatalog = await loadAccessCatalog(supabase);
  const access = await replaceManagerAccess(supabase, userId, req.body?.access || [], accessCatalog);
  return res.status(200).json({ success: true, access });
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const supabase = getServerClient();
    const admin = await requireAdmin(req, res, supabase);
    if (!admin) return undefined;

    if (req.method === 'GET') return handleList(supabase, res);
    if (req.method === 'POST') return handleCreate(req, supabase, res);
    if (req.body?.action === 'access') return handleAccessUpdate(req, supabase, res);
    return handlePasswordReset(req, supabase, res);
  } catch (error) {
    console.error('Falha na administração de usuários:', error);
    return res.status(error?.statusCode || 500).json({ error: error?.message || 'Falha ao administrar usuários.' });
  }
}
