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

export async function loadSystemUsersAdminData() {
  const payload = await authenticatedRequest('GET');
  return {
    users: payload.users || [],
    accessCatalog: payload.accessCatalog || [],
  };
}

export async function listSystemUsers() {
  const payload = await loadSystemUsersAdminData();
  return payload.users;
}

export async function createSystemUser({ name, email, password, role = 'manager', access = [] }) {
  const payload = await authenticatedRequest('POST', { name, email, password, role, access });
  return payload.user;
}

export async function resetSystemUserPassword(userId, password) {
  return authenticatedRequest('PATCH', { userId, password });
}

export async function saveSystemUserAccess(userId, access) {
  const payload = await authenticatedRequest('PATCH', {
    action: 'access',
    userId,
    access,
  });
  return payload.access || [];
}
