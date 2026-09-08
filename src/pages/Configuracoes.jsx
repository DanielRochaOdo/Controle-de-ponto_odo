import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Building, Clock3, Info, RefreshCw, Save, Users } from 'lucide-react';
import Layout from '@/components/layout/Layout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import {
  DEFAULT_SETTINGS,
  fetchLatestImport,
  fetchStructureSyncRuns,
  loadAttendanceSettings,
  saveAttendanceSettings,
  STATUS_LABELS,
  syncFlashStructure,
} from '@/lib/attendanceService';
import { FLASH_COMPANY_CATALOG, FLASH_SYNC_TARGETS } from '@/lib/flashCompanyCatalog';
import { TimeRecordStatus } from '@/types';

const STATUSES = [TimeRecordStatus.ON_TIME, TimeRecordStatus.LATE, TimeRecordStatus.LATE_EXIT, TimeRecordStatus.EARLY, TimeRecordStatus.ADJUSTED];
const PANEL = 'rounded-2xl border border-[#dfe9d7] bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900';
const FIELD = 'h-11 rounded-xl border border-[#cfe8bc] bg-white px-3 outline-none transition focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

const TARGET_UI = {
  employees: {
    icon: Users,
    description: 'Atualiza admissões, desligamentos e cadastro dos funcionários.',
    countLabel: (run) => `${run?.employees_processed || 0} funcionário(s)`,
  },
  departments: {
    icon: Building,
    description: 'Atualiza os cargos/departamentos cadastrados nesta empresa.',
    countLabel: (run) => `${run?.departments_processed || 0} cargo(s) / departamento(s)`,
  },
  schedules: {
    icon: Clock3,
    description: 'Consulta os horários de cada funcionário já sincronizado.',
    countLabel: (run) => `${run?.allocations_processed || 0} alocação(ões) de horário`,
  },
};

const syncKey = (companyKey, target) => `${companyKey}:${target}`;

const isRecentRunning = (run) => {
  if (run?.status !== 'running') return false;
  const value = run.progress_updated_at || run.started_at;
  if (!value) return false;
  return Date.now() - new Date(value).getTime() < 10 * 60 * 1000;
};

const SyncAction = ({ company, target, run, activeSync, onSync, dateTime }) => {
  const meta = TARGET_UI[target];
  const targetMeta = FLASH_SYNC_TARGETS[target];
  const Icon = meta.icon;
  const isThisActive = activeSync?.companyKey === company.key && activeSync?.target === target;
  const locked = Boolean(activeSync) && !isThisActive;
  const running = isThisActive || isRecentRunning(run);
  const failed = run?.status === 'failed' && !running;
  const completed = run?.status === 'completed';
  const processed = Number(run?.current_company_employees_processed || 0);
  const total = Number(run?.current_company_employees_total || 0);
  const progress = target === 'schedules' && total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : running ? 45 : completed ? 100 : 0;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-[#e2ecdc] bg-[#fbfdf9] p-4 dark:border-slate-800 dark:bg-slate-950/55">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e9f8e0] text-[#2f8f17] dark:bg-emerald-950 dark:text-emerald-300">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-[#173c2c] dark:text-slate-100">{targetMeta.label}</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{meta.description}</p>
        </div>
      </div>

      <div className="mt-4 min-h-[48px] rounded-xl bg-white px-3 py-2.5 text-xs dark:bg-slate-900">
        {running ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-[#2f8f17] dark:text-emerald-300">{run?.current_stage || 'Iniciando sincronização...'}</span>
              {target === 'schedules' && total > 0 && <strong className="text-[#173c2c] dark:text-slate-100">{processed}/{total}</strong>}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e3eddc] dark:bg-slate-800">
              <div className="h-full rounded-full bg-[#57D100] transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
          </>
        ) : failed ? (
          <div>
            <span className="font-semibold text-red-600 dark:text-red-300">Última tentativa falhou</span>
            <p className="mt-1 line-clamp-2 text-red-500/90 dark:text-red-300/80">{run?.error_message || 'Falha não detalhada.'}</p>
          </div>
        ) : completed ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="block text-slate-500 dark:text-slate-400">Última sincronização</span>
              <strong className="mt-0.5 block font-medium text-[#173c2c] dark:text-slate-100">{dateTime(run.finished_at)}</strong>
            </div>
            <span className="text-right text-[11px] text-slate-400">{meta.countLabel(run)}</span>
          </div>
        ) : (
          <span className="text-slate-400">Ainda não sincronizado.</span>
        )}
      </div>

      {target === 'schedules' && (
        <p className="mt-2 text-[11px] leading-4 text-amber-700 dark:text-amber-300">Requer funcionários sincronizados anteriormente nesta empresa.</p>
      )}

      <button
        onClick={() => onSync(company, target)}
        disabled={locked || running}
        className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#beddac] bg-white px-3 text-xs font-semibold text-[#2f8f17] transition hover:border-[#57D100] hover:bg-[#f3fced] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-slate-800"
      >
        <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
        {running ? 'Sincronizando...' : targetMeta.buttonLabel}
      </button>
    </div>
  );
};

const Configuracoes = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [latestImport, setLatestImport] = useState(null);
  const [syncRuns, setSyncRuns] = useState([]);
  const [saving, setSaving] = useState(false);
  const [activeSync, setActiveSync] = useState(null);

  const loadSyncRuns = async () => {
    if (!user) return [];
    const rows = await fetchStructureSyncRuns(user.id);
    setSyncRuns(rows);
    return rows;
  };

  useEffect(() => {
    if (!user) return;
    Promise.all([
      loadAttendanceSettings(user.id),
      fetchLatestImport(user.id),
      fetchStructureSyncRuns(user.id).catch(() => []),
    ])
      .then(([loaded, importRun, runs]) => {
        setSettings(loaded);
        setLatestImport(importRun);
        setSyncRuns(runs);

        const running = runs.find((run) => run.company_key && run.sync_target && isRecentRunning(run));
        if (running) setActiveSync({ companyKey: running.company_key, target: running.sync_target });
      })
      .catch((error) => toast({ title: 'Erro ao carregar configurações', description: error.message, variant: 'destructive' }));
  }, [user]);

  useEffect(() => {
    if (!user || !activeSync) return undefined;

    let cancelled = false;
    const refresh = async () => {
      try {
        const rows = await fetchStructureSyncRuns(user.id);
        if (cancelled) return;
        setSyncRuns(rows);
        const current = rows.find((run) => run.company_key === activeSync.companyKey && run.sync_target === activeSync.target);
        if (current && current.status !== 'running') setActiveSync(null);
      } catch (error) {
        console.error('[Sincronização Flash] Falha ao consultar progresso:', error);
      }
    };

    const timer = window.setInterval(refresh, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user, activeSync]);

  const latestRuns = useMemo(() => {
    const map = new Map();
    syncRuns.forEach((run) => {
      if (!run.company_key || !run.sync_target) return;
      const key = syncKey(run.company_key, run.sync_target);
      if (!map.has(key)) map.set(key, run);
    });
    return map;
  }, [syncRuns]);

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
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (company, target) => {
    if (!user || activeSync) return;
    setActiveSync({ companyKey: company.key, target });
    try {
      const result = await syncFlashStructure(company.key, target);
      await loadSyncRuns();

      const descriptions = {
        employees: `${result.employeesProcessed} funcionário(s) atualizado(s).`,
        departments: `${result.departmentsProcessed} cargo(s) / departamento(s) atualizado(s).`,
        schedules: `${result.allocationsProcessed} alocação(ões) de horário atualizada(s) para ${result.employeesProcessed} funcionário(s).`,
      };
      const warning = result.warningCount ? ` ${result.warningCount} consulta(s) de horário tiveram aviso.` : '';
      toast({ title: `${company.name} sincronizada`, description: `${descriptions[target]}${warning}` });
    } catch (error) {
      await loadSyncRuns().catch(() => null);
      toast({ title: `Falha em ${company.name}`, description: error.message, variant: 'destructive' });
    } finally {
      setActiveSync(null);
    }
  };

  const dateTime = (value) => value ? new Date(value).toLocaleString('pt-BR') : 'Ainda não disponível';

  return (
    <>
      <Helmet><title>Configurações | Controle de Ponto</title></Helmet>
      <Layout>
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-[#173c2c] dark:text-slate-50">Configurações</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie as regras do ponto e as integrações cadastrais da Flash.</p>
        </div>

        <div className="mt-6 inline-flex rounded-xl border border-[#dfe9d7] bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <button
            onClick={() => setActiveTab('general')}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition ${activeTab === 'general' ? 'bg-[#57D100] text-[#064E2C]' : 'text-slate-500 hover:bg-[#f5faf1] dark:text-slate-400 dark:hover:bg-slate-800'}`}
          >
            Geral
          </button>
          <button
            onClick={() => setActiveTab('flash')}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition ${activeTab === 'flash' ? 'bg-[#57D100] text-[#064E2C]' : 'text-slate-500 hover:bg-[#f5faf1] dark:text-slate-400 dark:hover:bg-slate-800'}`}
          >
            Estrutura Flash
          </button>
        </div>

        {activeTab === 'general' && (
          <div className="mt-5">
            <div className="flex justify-end">
              <button onClick={save} disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#57D100] px-5 text-sm font-semibold text-[#064E2C] shadow-sm transition hover:bg-[#4cc000] disabled:opacity-60">
                <Save className="h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>

            <div className="mt-4 grid gap-5 xl:grid-cols-2">
              <section className={PANEL}>
                <h2 className="text-xl font-semibold text-[#173c2c] dark:text-slate-100">Tolerâncias (em minutos)</h2>
                <div className="mt-6 space-y-4">
                  {STATUSES.map((status) => (
                    <div key={status} className="grid grid-cols-[1fr_120px_24px] items-center gap-3">
                      <label htmlFor={`tol-${status}`} className="text-sm font-medium text-slate-700 dark:text-slate-300">{STATUS_LABELS[status]}</label>
                      <input id={`tol-${status}`} type="number" min="0" max="60" value={settings.tolerances[status]} onChange={(event) => updateTolerance(status, event.target.value)} className={FIELD} />
                      <span title={status === TimeRecordStatus.ADJUSTED ? 'O status Ajustado vem sinalizado pela origem; o valor é mantido como configuração de referência.' : 'Limite em minutos usado na classificação.'}>
                        <Info className="h-4 w-4 text-[#6b8a74] dark:text-slate-500" />
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className={PANEL}>
                <h2 className="text-xl font-semibold text-[#173c2c] dark:text-slate-100">Cores dos status</h2>
                <div className="mt-6 space-y-4">
                  {STATUSES.map((status) => (
                    <div key={status} className="grid grid-cols-[1fr_42px_132px] items-center gap-3">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{STATUS_LABELS[status]}</span>
                      <input type="color" value={settings.colors[status]} onChange={(event) => updateColor(status, event.target.value)} className="h-9 w-9 cursor-pointer rounded-full border-0 bg-transparent p-0" />
                      <input value={settings.colors[status]} onChange={(event) => updateColor(status, event.target.value)} className={`${FIELD} font-mono text-sm uppercase`} />
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className={`${PANEL} mt-5`}>
              <h2 className="text-xl font-semibold text-[#173c2c] dark:text-slate-100">Informações do sistema</h2>
              <dl className="mt-5 divide-y divide-[#edf6e7] text-sm dark:divide-slate-800">
                <div className="grid gap-2 py-3 sm:grid-cols-3"><dt className="text-slate-500">Empresas Flash configuradas</dt><dd className="font-medium text-[#065F2F] dark:text-emerald-300 sm:col-span-2">{FLASH_COMPANY_CATALOG.length} empresas</dd></div>
                <div className="grid gap-2 py-3 sm:grid-cols-3"><dt className="text-slate-500">Última atualização de registros</dt><dd className="text-slate-700 dark:text-slate-300 sm:col-span-2">{dateTime(latestImport?.finished_at)}</dd></div>
                <div className="grid gap-2 py-3 sm:grid-cols-3"><dt className="text-slate-500">Última alteração nas configurações</dt><dd className="text-slate-700 dark:text-slate-300 sm:col-span-2">{dateTime(settings.updatedAt)}</dd></div>
              </dl>
            </section>
          </div>
        )}

        {activeTab === 'flash' && (
          <div className="mt-5">
            <section className="rounded-2xl border border-[#cfe8bf] bg-[linear-gradient(110deg,#f3fced_0%,#ffffff_70%,#f4fbef_100%)] p-6 shadow-sm dark:border-emerald-900/60 dark:bg-none dark:bg-emerald-950/20">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#e7f7dc] text-[#2f8f17] dark:bg-emerald-950 dark:text-emerald-300"><RefreshCw className="h-6 w-6" /></span>
                <div>
                  <h2 className="text-xl font-semibold text-[#173c2c] dark:text-slate-100">Sincronização por empresa</h2>
                  <p className="mt-1 max-w-4xl text-sm leading-6 text-[#63796b] dark:text-slate-400">Atualize somente o recurso que realmente mudou. Funcionários, cargos/departamentos e horários são independentes; isso reduz o volume de chamadas à Flash e deixa a manutenção mais previsível.</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-white px-3 py-1.5 font-medium text-[#2f8f17] shadow-sm dark:bg-slate-900 dark:text-emerald-300">9 empresas</span>
                    <span className="rounded-full bg-white px-3 py-1.5 text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-400">3 ações independentes por empresa</span>
                    <span className="rounded-full bg-white px-3 py-1.5 text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-400">Horários usam funcionários já sincronizados</span>
                  </div>
                </div>
              </div>
            </section>

            <div className="mt-5 space-y-4">
              {FLASH_COMPANY_CATALOG.map((company, index) => (
                <section key={company.key} className="rounded-2xl border border-[#dfe9d7] bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eef9e7] font-semibold text-[#2f8f17] dark:bg-emerald-950 dark:text-emerald-300">{String(index + 1).padStart(2, '0')}</span>
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-[#173c2c] dark:text-slate-100">{company.name}</h3>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{company.cnpj ? `CNPJ ${company.cnpj}` : 'CNPJ não informado no catálogo local'}</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-[#f0fae9] px-3 py-1.5 text-xs font-medium text-[#2f8f17] dark:bg-emerald-950 dark:text-emerald-300">Sincronização seletiva</span>
                  </div>

                  <div className="mt-5 grid gap-3 lg:grid-cols-3">
                    {['employees', 'departments', 'schedules'].map((target) => (
                      <SyncAction
                        key={target}
                        company={company}
                        target={target}
                        run={latestRuns.get(syncKey(company.key, target))}
                        activeSync={activeSync}
                        onSync={handleSync}
                        dateTime={dateTime}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </Layout>
    </>
  );
};

export default Configuracoes;
