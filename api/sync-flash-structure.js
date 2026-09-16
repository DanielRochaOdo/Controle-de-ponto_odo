import { createClient } from '@supabase/supabase-js';
import syncFlashStructureCore from './_lib/sync-flash-structure-core.js';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });

  try {
    const supabase = getServerClient();
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return res.status(401).json({ stage: 'autenticação da sessão', error: 'Sessão inválida ou expirada.' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', authData.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (profile?.role !== 'admin') {
      return res.status(403).json({ stage: 'autorização do usuário', error: 'Acesso restrito a administradores.' });
    }

    return syncFlashStructureCore(req, res);
  } catch (error) {
    console.error('Falha ao autorizar sincronização Flash:', error);
    return res.status(500).json({
      stage: 'autorização do usuário',
      error: error?.message || 'Falha ao validar permissão do usuário.',
    });
  }
}
