import { supabase } from '@/lib/customSupabaseClient';

async function authenticatedRequest(method, body) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) throw new Error('Sessão expirada. Entre novamente no sistema.');

  const response = await fetch('/api/admin-users', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Falha na administração de usuários.');
  return payload;
}

export async function listSystemUsers() {
  const payload = await authenticatedRequest('GET');
  return payload.users || [];
}

export async function createSystemUser({ name, email, password }) {
  const payload = await authenticatedRequest('POST', { name, email, password });
  return payload.user;
}

export async function resetSystemUserPassword(userId, password) {
  return authenticatedRequest('PATCH', { userId, password });
}
