import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Plus, RefreshCw, User } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  createSystemUser,
  listSystemUsers,
  resetSystemUserPassword,
} from '@/lib/userAdminService';

const FIELD = 'h-11 w-full rounded-xl border border-[#cfe8bc] bg-white px-3 outline-none transition focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
const PANEL = 'rounded-2xl border border-[#dfe9d7] bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900';

const UsersSettings = () => {
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'manager' });
  const [resetUserId, setResetUserId] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      setUsers(await listSystemUsers());
    } catch (error) {
      toast({ title: 'Erro ao carregar usuários', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!form.email.trim() || !form.password) {
      toast({ title: 'Campos obrigatórios', description: 'Informe e-mail e senha.', variant: 'destructive' });
      return;
    }

    setCreating(true);
    try {
      const created = await createSystemUser(form);
      setForm({ name: '', email: '', password: '', role: 'manager' });
      setShowCreatePassword(false);
      setUsers((current) => [...current, created].sort((a, b) => a.email.localeCompare(b.email, 'pt-BR')));
      toast({
        title: 'Usuário criado',
        description: `${created.email} foi criado como ${created.role === 'admin' ? 'admin' : 'manager'}.`,
      });
    } catch (error) {
      toast({ title: 'Não foi possível criar o usuário', description: error.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const startReset = (userId) => {
    setResetUserId((current) => current === userId ? null : userId);
    setResetPassword('');
    setShowResetPassword(false);
  };

  const handleResetPassword = async (user) => {
    if (!resetPassword) {
      toast({ title: 'Nova senha obrigatória', description: 'Informe a nova senha antes de salvar.', variant: 'destructive' });
      return;
    }

    setResetting(true);
    try {
      await resetSystemUserPassword(user.id, resetPassword);
      setResetUserId(null);
      setResetPassword('');
      setShowResetPassword(false);
      toast({ title: 'Senha alterada', description: `A senha de ${user.email} foi atualizada diretamente.` });
    } catch (error) {
      toast({ title: 'Não foi possível alterar a senha', description: error.message, variant: 'destructive' });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="mt-5 space-y-5">
      <section className={PANEL}>
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eef9e7] text-[#2f8f17] dark:bg-emerald-950 dark:text-emerald-300">
            <Plus className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-[#173c2c] dark:text-slate-100">Criar usuário</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Escolha o nível de acesso do novo usuário. O padrão é Manager.</p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="mt-6 grid gap-4 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Nome de usuário <span className="font-normal text-slate-400">(opcional)</span></span>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className={FIELD}
              placeholder="Nome para exibição"
              autoComplete="off"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">E-mail</span>
            <input
              type="email"
              required
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              className={FIELD}
              placeholder="usuario@empresa.com"
              autoComplete="off"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Senha</span>
            <span className="relative block">
              <input
                type={showCreatePassword ? 'text' : 'password'}
                required
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                className={`${FIELD} pr-11`}
                placeholder="Senha inicial"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowCreatePassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#065F2F] dark:hover:text-emerald-300"
                aria-label={showCreatePassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showCreatePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Perfil</span>
            <select
              value={form.role}
              onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
              className={FIELD}
            >
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <div className="flex justify-end lg:col-span-4">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#57D100] px-5 text-sm font-semibold text-[#064E2C] shadow-sm transition hover:bg-[#4cc000] disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              {creating ? 'Criando...' : 'Criar usuário'}
            </button>
          </div>
        </form>
      </section>

      <section className={`${PANEL} p-0 overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-[#e8f0e3] px-6 py-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#173c2c] dark:text-slate-100">Usuários cadastrados</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Consulte os acessos existentes e altere senhas diretamente.</p>
          </div>
          <button
            type="button"
            onClick={loadUsers}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#cfe8bc] px-4 text-sm font-semibold text-[#2f8f17] transition hover:bg-[#f5faf1] disabled:opacity-60 dark:border-slate-700 dark:text-emerald-300 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar lista
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[#f7fbf4] text-left text-xs uppercase tracking-wide text-[#63776b] dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-6 py-3">Usuário</th>
                <th className="px-6 py-3">E-mail</th>
                <th className="px-6 py-3">Perfil</th>
                <th className="px-6 py-3">Criado em</th>
                <th className="px-6 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <React.Fragment key={item.id}>
                  <tr className="border-t border-[#edf3e9] dark:border-slate-800">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eef9e7] text-[#2f8f17] dark:bg-emerald-950 dark:text-emerald-300"><User className="h-4 w-4" /></span>
                        <span className="font-medium text-[#173c2c] dark:text-slate-100">{item.name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{item.email}</td>
                    <td className="px-6 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.role === 'admin' ? 'bg-[#eaf8df] text-[#065F2F] dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{item.role === 'admin' ? 'Admin' : 'Manager'}</span></td>
                    <td className="px-6 py-4 text-slate-500">{item.createdAt ? new Date(item.createdAt).toLocaleString('pt-BR') : '—'}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => startReset(item.id)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d7e5cf] px-3 text-xs font-semibold text-[#425c4e] transition hover:bg-[#f5faf1] hover:text-[#065F2F] dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <KeyRound className="h-4 w-4" />
                        Alterar senha
                      </button>
                    </td>
                  </tr>
                  {resetUserId === item.id && (
                    <tr className="border-t border-[#edf3e9] bg-[#fbfdf9] dark:border-slate-800 dark:bg-slate-950/50">
                      <td colSpan="5" className="px-6 py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end">
                          <label className="w-full sm:max-w-sm">
                            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Nova senha para {item.email}</span>
                            <span className="relative block">
                              <input
                                type={showResetPassword ? 'text' : 'password'}
                                value={resetPassword}
                                onChange={(event) => setResetPassword(event.target.value)}
                                className={`${FIELD} pr-11`}
                                placeholder="Digite a nova senha"
                                autoComplete="new-password"
                              />
                              <button
                                type="button"
                                onClick={() => setShowResetPassword((value) => !value)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#065F2F] dark:hover:text-emerald-300"
                                aria-label={showResetPassword ? 'Ocultar senha' : 'Mostrar senha'}
                              >
                                {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </span>
                          </label>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => startReset(item.id)} className="h-11 rounded-xl border border-[#d7e5cf] px-4 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">Cancelar</button>
                            <button type="button" onClick={() => handleResetPassword(item)} disabled={resetting} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#57D100] px-4 text-sm font-semibold text-[#064E2C] disabled:opacity-60">
                              <KeyRound className="h-4 w-4" />
                              {resetting ? 'Alterando...' : 'Salvar nova senha'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {!loading && users.length === 0 && (
                <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-400">Nenhum usuário cadastrado.</td></tr>
              )}
              {loading && (
                <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-400">Carregando usuários...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default UsersSettings;
