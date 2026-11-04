import { createClient } from '@supabase/supabase-js';
import { getFlashCompanies } from './_lib/flashCompanies.js';

const getServerClient = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Supabase não está configurado no backend.');
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
};

const getToken = (req) => {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : null;
};

async function authenticate(req, res, supabase, requireAdmin = false) {
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

  if (requireAdmin) {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', authData.user.id)
      .maybeSingle();
    if (error) throw error;
    if (profile?.role !== 'admin') {
      res.status(403).json({ error: 'Acesso restrito a administradores.' });
      return null;
    }
  }

  return authData.user;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const supabase = getServerClient();
    const user = await authenticate(req, res, supabase, req.method === 'POST');
    if (!user) return;

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('flash_structure_sync_settings')
        .select('is_enabled,is_running,last_updated_at,running_started_at')
        .eq('id', 1)
        .single();
      if (error) throw error;
      const staleRun = data.is_running && data.running_started_at
        && Date.now() - new Date(data.running_started_at).getTime() > 4 * 60 * 60 * 1000;
      if (staleRun) {
        await supabase
          .from('flash_structure_sync_settings')
          .update({ is_running: false, running_started_at: null })
          .eq('id', 1)
          .eq('running_started_at', data.running_started_at);
        data.is_running = false;
        data.running_started_at = null;
      }
      const status = {
        is_enabled: data.is_enabled,
        is_running: data.is_running,
        last_updated_at: data.last_updated_at,
      };
      return res.status(200).json(status);
    }

    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Informe se a sincronização automática deve ficar ativa.' });

    if (enabled) {
      if (!process.env.FLASH_API_KEY) return res.status(500).json({ error: 'FLASH_API_KEY não configurada no backend.' });
      const missingCompanies = getFlashCompanies().filter((company) => !company.id);
      if (missingCompanies.length) {
        return res.status(409).json({ error: `Configure todas as empresas Flash no backend antes de ativar (${missingCompanies.length} pendente(s)).` });
      }
    }

    const { data, error } = await supabase
      .from('flash_structure_sync_settings')
      .update({ is_enabled: enabled, is_running: false, running_started_at: null, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .or(`is_running.eq.false,running_started_at.lt.${new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()}`)
      .select('is_enabled,is_running,last_updated_at,running_started_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'Aguarde a sincronização em andamento terminar para alterar essa configuração.' });
    const status = {
      is_enabled: data.is_enabled,
      is_running: data.is_running,
      last_updated_at: data.last_updated_at,
    };
    return res.status(200).json(status);
  } catch (error) {
    console.error('[Sincronização Flash automática] Falha ao consultar ou salvar configuração:', error);
    return res.status(500).json({ error: error?.message || 'Falha ao acessar a configuração da sincronização automática.' });
  }
}
