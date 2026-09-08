import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Info, Save } from 'lucide-react';
import Layout from '@/components/layout/Layout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { DEFAULT_SETTINGS, fetchLatestImport, loadAttendanceSettings, saveAttendanceSettings, STATUS_LABELS } from '@/lib/attendanceService';
import { TimeRecordStatus } from '@/types';

const STATUSES = [TimeRecordStatus.ON_TIME, TimeRecordStatus.LATE, TimeRecordStatus.LATE_EXIT, TimeRecordStatus.EARLY, TimeRecordStatus.ADJUSTED];
const PANEL = 'rounded-2xl border border-[#dfe9d7] bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900';
const FIELD = 'h-11 rounded-xl border border-[#cfe8bc] bg-white px-3 outline-none transition focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

const Configuracoes = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [latestImport, setLatestImport] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([loadAttendanceSettings(user.id), fetchLatestImport(user.id)])
      .then(([loaded, importRun]) => { setSettings(loaded); setLatestImport(importRun); })
      .catch((error) => toast({ title: 'Erro ao carregar configurações', description: error.message, variant: 'destructive' }));
  }, [user]);

  const updateTolerance = (status, value) => {
    const number = Math.max(0, Math.min(60, Number(value) || 0));
    setSettings((old) => ({ ...old, tolerances: { ...old.tolerances, [status]: number } }));
  };

  const updateColor = (status, value) => setSettings((old) => ({ ...old, colors: { ...old.colors, [status]: value } }));

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const updated = await saveAttendanceSettings(user.id, settings);
      setSettings(updated);
      toast({ title: 'Configurações salvas', description: 'Tolerâncias e cores foram atualizadas.' });
    } catch (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const dateTime = (value) => value ? new Date(value).toLocaleString('pt-BR') : 'Ainda não disponível';

  return (
    <>
      <Helmet><title>Configurações | Controle de Ponto</title></Helmet>
      <Layout>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div><h1 className="text-3xl font-semibold tracking-tight text-[#173c2c] dark:text-slate-50">Configurações</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ajuste as tolerâncias e as cores dos status.</p></div>
          <button onClick={save} disabled={saving} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#57D100] px-5 font-medium text-[#064E2C] shadow-sm transition hover:bg-[#4cc000] disabled:opacity-60"><Save className="h-5 w-5"/>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          <section className={PANEL}>
            <h2 className="text-xl font-semibold text-[#173c2c] dark:text-slate-100">Tolerâncias (em minutos)</h2>
            <div className="mt-6 space-y-4">
              {STATUSES.map((status) => <div key={status} className="grid grid-cols-[1fr_120px_24px] items-center gap-3"><label htmlFor={`tol-${status}`} className="text-sm font-medium text-slate-700 dark:text-slate-300">{STATUS_LABELS[status]}</label><input id={`tol-${status}`} type="number" min="0" max="60" value={settings.tolerances[status]} onChange={(e) => updateTolerance(status, e.target.value)} className={FIELD}/><span title={status === TimeRecordStatus.ADJUSTED ? 'O status Ajustado vem sinalizado pela origem; o valor é mantido como configuração de referência.' : 'Limite em minutos usado na classificação.'}><Info className="h-4 w-4 text-[#6b8a74] dark:text-slate-500"/></span></div>)}
            </div>
          </section>

          <section className={PANEL}>
            <h2 className="text-xl font-semibold text-[#173c2c] dark:text-slate-100">Cores dos status</h2>
            <div className="mt-6 space-y-4">
              {STATUSES.map((status) => <div key={status} className="grid grid-cols-[1fr_42px_132px] items-center gap-3"><span className="text-sm font-medium text-slate-700 dark:text-slate-300">{STATUS_LABELS[status]}</span><input type="color" value={settings.colors[status]} onChange={(e) => updateColor(status, e.target.value)} className="h-9 w-9 cursor-pointer rounded-full border-0 bg-transparent p-0"/><input value={settings.colors[status]} onChange={(e) => updateColor(status, e.target.value)} className={`${FIELD} font-mono text-sm uppercase`}/></div>)}
            </div>
          </section>
        </div>

        <section className={`${PANEL} mt-5`}>
          <h2 className="text-xl font-semibold text-[#173c2c] dark:text-slate-100">Informações do sistema</h2>
          <dl className="mt-5 divide-y divide-[#edf6e7] text-sm dark:divide-slate-800">
            <div className="grid gap-2 py-3 sm:grid-cols-3"><dt className="text-slate-500">Empresa</dt><dd className="font-medium text-[#065F2F] dark:text-emerald-300 sm:col-span-2">Odontoart</dd></div>
            <div className="grid gap-2 py-3 sm:grid-cols-3"><dt className="text-slate-500">Última atualização da Flash</dt><dd className="text-slate-700 dark:text-slate-300 sm:col-span-2">{dateTime(latestImport?.finished_at)}</dd></div>
            <div className="grid gap-2 py-3 sm:grid-cols-3"><dt className="text-slate-500">Última alteração nas configurações</dt><dd className="text-slate-700 dark:text-slate-300 sm:col-span-2">{dateTime(settings.updatedAt)}</dd></div>
          </dl>
        </section>
      </Layout>
    </>
  );
};

export default Configuracoes;
