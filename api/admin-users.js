import { createClient } from '@supabase/supabase-js';

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

async function handleList(supabase, res) {
  const [authUsers, profilesResult] = await Promise.all([
    listAllAuthUsers(supabase),
    supabase.from('user_profiles').select('user_id,display_name,role'),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  const profiles = new Map((profilesResult.data || []).map((profile) => [profile.user_id, profile]));

  const users = authUsers
    .map((user) => {
      const profile = profiles.get(user.id);
      return {
        id: user.id,
        name: user.user_metadata?.name || profile?.display_name || '',
        email: user.email || '',
        role: profile?.role || 'manager',
        createdAt: user.created_at || null,
        lastSignInAt: user.last_sign_in_at || null,
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email, 'pt-BR'));

  return res.status(200).json({ users });
}

async function handleCreate(req, supabase, res) {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const name = normalizeName(req.body?.name);

  if (!email) return res.status(400).json({ error: 'E-mail é obrigatório.' });
  if (!password) return res.status(400).json({ error: 'Senha é obrigatória.' });

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: name ? { name } : {},
  });

  if (error) return res.status(400).json({ error: error.message || 'Não foi possível criar o usuário.' });

  const createdUser = data?.user;
  if (!createdUser?.id) return res.status(500).json({ error: 'Usuário criado sem identificador.' });

  const displayName = name || email.split('@')[0] || 'Usuário';
  const { error: profileError } = await supabase
    .from('user_profiles')
    .upsert({
      user_id: createdUser.id,
      display_name: displayName,
      role: 'manager',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (profileError) {
    await supabase.auth.admin.deleteUser(createdUser.id).catch(() => null);
    throw profileError;
  }

  return res.status(201).json({
    user: {
      id: createdUser.id,
      name: name || displayName,
      email,
      role: 'manager',
      createdAt: createdUser.created_at || null,
      lastSignInAt: null,
    },
  });
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
    return handlePasswordReset(req, supabase, res);
  } catch (error) {
    console.error('Falha na administração de usuários:', error);
    return res.status(500).json({ error: error?.message || 'Falha ao administrar usuários.' });
  }
}
