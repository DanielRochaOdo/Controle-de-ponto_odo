import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Building, Clock3, RefreshCw, Save, Users } from 'lucide-react';
import Layout from '@/components/layout/Layout';
import UsersSettings from '@/components/settings/UsersSettings';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import {
  DEFAULT_SETTINGS,
  fetchFlashStructureAutoSyncSettings,
  fetchLatestImport,
  fetchStructureSyncRuns,
  loadAttendanceSettings,
  saveAttendanceSettings,
  STATUS_LABELS,
  syncFlashStructure,
  updateFlashStructureAutoSync,
} from '@/lib/attendanceService';
import { FLASH_COMPANY_CATALOG, FLASH_SYNC_TARGETS } from '@/lib/flashCompanyCatalog';
import { TimeRecordStatus } from '@/types';

const STATUSES = [TimeRecordStatus.ON_TIME, TimeRecordStatus.LATE, TimeRecordStatus.LATE_EXIT, TimeRecordStatus.EARLY, TimeRecordStatus.ADJUSTED];
const PANEL = 'rounded-2xl border border-[#dfe9d7] bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900';
const FIELD = 'h-11 rounded-xl border border-[#cfe8bc] bg-white px-3 outline-none transition focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
const CONFIG_TAB_KEY = 'controle-ponto:configuracoes:tab';
const VALID_TABS = new Set(['general', 'flash', 'users']);

const initialConfigTab = () => {
  if (typeof window === 'undefined') return 'general';
  const stored = window.sessionStorage.getItem(CONFIG_TAB_KEY);
  return VALID_TABS.has(stored) ? stored : 'general';
};

const TARGET_UI = {
  employees: {
    step: 1,
    icon: Users,
    description: 'Atualiza os funcionários e captura o ID do departamento informado pela Flash.',
    countLabel: (run) => `${run?.employees_processed || 0} funcionário(s)`,
  },
  departments: {
    step: 2,
    icon: Building,
    description: 'Atualiza os departamentos e vincula seus nomes aos funcionários pelo ID.',
    countLabel: (run) => `${run?.departments_processed || 0} departamento(s)`,
  },
  schedules: {
    step: 3,
    icon: Clock3,
    description: 'Consulta os horários de cada funcionário já sincronizado.',
    countLabel: (run) => `${run?.allocations_processed || 0} alocação(ões) de horário`,
  },
};

const syncKey = (companyKey, target) => `${companyKey}:${target}`;

const AUTO_SYNC_TARGET_LABELS = {
  employees: 'Funcionários',
  departments: 'Departamentos',
  schedules: 'Horários',
};

const isRecentRunning = (run) => {
  if (run?.status !== 'running') return false;
  const value = run.progress_updated_at || run.started_at;
  if (!value) return false;
  return Date.now() - new Date(value).getTime() < 10 * 60 * 1000;
};

const SyncAction = ({ company, target, run, activeSync, onSync, dateTime, syncBlocked }) => {
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
  const progress = target === 'schedules' && total > 0
    ? Math.min(100, Math.round((processed / total) * 100))
    : running ? 45 : completed ? 100 : 0;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-[#e2ecdc] bg-[#fbfdf9] p-4 dark:border-slate-800 dark:bg-slate-950/55">
      <div className="flex items-start gap-3">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e9f8e0] text-[#2f8f17] dark:bg-emerald-950 dark:text-emerald-300">
          <Icon className="h-5 w-5" />
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#57D100] px-1 text-[10px] font-bold text-[#064E2C]">{meta.step}</span>
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-[#173c2c] dark:text-slate-100">{targetMeta.label}</h4>
            <span className="rounded-full bg-[#edf8e6] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#2f8f17] dark:bg-emerald-950 dark:text-emerald-300">Etapa {meta.step}</span>
          </div>
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

      {target === 'departments' && (
        <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">Se os funcionários já estiverem sincronizados, os nomes dos departamentos são vinculados automaticamente pelos IDs.</p>
      )}
      {target === 'schedules' && (
        <p className="mt-2 text-[11px] leading-4 text-amber-700 dark:text-amber-300">Requer funcionários sincronizados anteriormente nesta empresa.</p>
      )}

      <button
        onClick={() => onSync(company, target)}
        disabled={locked || running || syncBlocked}
        className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#beddac] bg-white px-3 text-xs font-semibold text-[#2f8f17] transition hover:border-[#57D100] hover:bg-[#f3fced] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-slate-800"
      >
        <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
        {running ? 'Sincronizando...' : targetMeta.buttonLabel}
      </button>
    </div>
  );
};

const TabButton = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition ${active ? 'bg-[#57D100] text-[#064E2C]' : 'text-slate-500 hover:bg-[#f5faf1] dark:text-slate-400 dark:hover:bg-slate-800'}`}
  >
    {children}
  </button>
);

const Configuracoes = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState(initialConfigTab);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [latestImport, setLatestImport] = useState(null);
  const [syncRuns, setSyncRuns] = useState([]);
  const [saving, setSaving] = useState(false);
  const [activeSync, setActiveSync] = useState(null);
  const [autoSync, setAutoSync] = useState({ is_enabled: false, is_running: false, last_updated_at: null });
  const [autoSyncLoaded, setAutoSyncLoaded] = useState(false);
  const [autoSyncSaving, setAutoSyncSaving] = useState(false);

  const loadSyncRuns = async () => {
    if (!user) return [];
    const rows = await fetchStructureSyncRuns(user.id);
    setSyncRuns(rows);
    return rows;
  };

  useEffect(() => {
    window.sessionStorage.setItem(CONFIG_TAB_KEY, activeTab);
  }, [activeTab]);

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
    if (!user) return undefined;
    let cancelled = false;

    const refreshAutoSync = async (showError = false) => {
      try {
        const status = await fetchFlashStructureAutoSyncSettings();
        if (!cancelled) {
          setAutoSync(status);
          setAutoSyncLoaded(true);
        }
      } catch (error) {
        if (!cancelled) {
          setAutoSyncLoaded(true);
          if (showError) toast({ title: 'Erro ao carregar sincronização automática', description: error.message, variant: 'destructive' });
        }
      }
    };

    refreshAutoSync(true);
    const timer = window.setInterval(() => refreshAutoSync(), autoSync.is_running ? 3000 : 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user, toast, autoSync.is_running]);

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

  const updateTolerance = (status, side, value) => {
    const number = Math.max(0, Math.min(60, Number(value) || 0));
    setSettings((old) => ({
      ...old,
      statusTolerances: {
        ...old.statusTolerances,
        [status]: {
          ...(old.statusTolerances?.[status] || { before: 0, after: 0 }),
          [side]: number,
        },
      },
    }));
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
    if (!user || activeSync || autoSync.is_enabled || autoSync.is_running) return;
    setActiveSync({ companyKey: company.key, target });
    try {
      const result = await syncFlashStructure(company.key, target);
      await loadSyncRuns();

      const descriptions = {
        employees: `${result.employeesProcessed} funcionário(s) atualizado(s).`,
        departments: `${result.departmentsProcessed} departamento(s) atualizado(s).`,
        schedules: `${result.allocationsProcessed} alocação(ões) de horário atualizada(s) para ${result.employeesProcessed} funcionário(s).`,
      };
      const warning = result.warningCount
        ? target === 'schedules'
          ? ` ${result.warningCount} consulta(s) de horário tiveram aviso.`
          : ` ${result.warningCount} aviso(s) de vínculo cadastral.`
        : '';
      toast({ title: `${company.name} sincronizada`, description: `${descriptions[target]}${warning}` });
    } catch (error) {
      await loadSyncRuns().catch(() => null);
      toast({ title: `Falha em ${company.name}`, description: error.message, variant: 'destructive' });
    } finally {
      setActiveSync(null);
    }
  };

  const dateTime = (value) => value ? new Date(value).toLocaleString('pt-BR') : 'Ainda não disponível';

  const autoSyncDateTime = (value) => value
    ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
    : 'Ainda não realizada';

  const toggleAutoSync = async () => {
    if (autoSyncSaving || autoSync.is_running || profile?.role !== 'admin') return;
    setAutoSyncSaving(true);
    try {
      const updated = await updateFlashStructureAutoSync(!autoSync.is_enabled);
      setAutoSync(updated);
      toast({
        title: updated.is_enabled ? 'Sincronização automática ativada' : 'Sincronização automática desativada',
        description: updated.is_enabled
          ? 'A sincronização geral será executada de segunda a sexta às 07h.'
          : 'As sincronizações seletivas estão liberadas.',
      });
    } catch (error) {
      toast({ title: 'Não foi possível alterar a sincronização automática', description: error.message, variant: 'destructive' });
    } finally {
      setAutoSyncSaving(false);
    }
  };

  const syncBlocked = !autoSyncLoaded || autoSync.is_enabled || autoSync.is_running;

  return (
    <>
      <Helmet><title>Configurações | Controle de Ponto</title></Helmet>
      <Layout>
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-[#173c2c] dark:text-slate-50">Configurações</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie as regras do ponto, os usuários e as integrações cadastrais da Flash.</p>
        </div>

        <div className="mt-6 inline-flex flex-wrap rounded-xl border border-[#dfe9d7] bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <TabButton active={activeTab === 'general'} onClick={() => setActiveTab('general')}>Geral</TabButton>
          <TabButton active={activeTab === 'flash'} onClick={() => setActiveTab('flash')}>Estrutura Flash</TabButton>
          <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')}>Usuários</TabButton>
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
                <h2 className="text-xl font-semibold text-[#173c2c] dark:text-slate-100">Tolerâncias de ponto</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">Defina quantos minutos de antecipação ou atraso serão aceitos. Dentro desses limites, a batida fica como No horário.</p>

                <div className="mt-6 divide-y divide-[#e8f0e3] overflow-hidden rounded-xl border border-[#e2ecdc] dark:divide-slate-800 dark:border-slate-800">
                  {[
                    { status: TimeRecordStatus.EARLY, side: 'before', label: 'Antecipação tolerada', detail: 'Minutos antes do previsto, para entrada e saída.' },
                    { status: TimeRecordStatus.LATE, side: 'after', label: 'Atraso tolerado', detail: 'Minutos depois da entrada prevista.' },
                    { status: TimeRecordStatus.LATE_EXIT, side: 'after', label: 'Saída após horário tolerada', detail: 'Minutos depois da saída prevista.' },
                  ].map(({ status, side, label, detail }) => (
                    <label key={status} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
                        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{detail}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <input
                          aria-label={label}
                          type="number"
                          min="0"
                          max="60"
                          step="1"
                          value={settings.statusTolerances?.[status]?.[side] ?? 5}
                          onChange={(event) => updateTolerance(status, side, event.target.value)}
                          className={`${FIELD} w-20 px-2 text-center`}
                        />
                        <span className="text-xs text-slate-400">min</span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="mt-4 rounded-xl bg-[#effbe8] px-4 py-3 text-xs leading-5 text-[#456454] dark:bg-emerald-950/40 dark:text-emerald-200">
                  Exemplo: saída prevista às 18:00, tolerância de 5 minutos depois: 18:01 até 18:05:59 ficam como No horário; a partir de 18:06:00, Saída após horário. Um ajuste registrado pela Flash permanece Ajustado.
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
            <section className="rounded-2xl border border-[#cfe8bf] bg-[linear-gradient(110deg,#f3fced_0%,#ffffff_70%,#f4fbef_100%)] p-5 shadow-sm dark:border-emerald-900/60 dark:bg-none dark:bg-emerald-950/20">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <h2 className="text-xl font-semibold text-[#173c2c] dark:text-slate-100">Sincronização por empresa</h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 xl:justify-end">
                  <span className="text-sm text-slate-700 dark:text-slate-300">Sincronização automática</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoSync.is_enabled}
                    aria-label="Sincronização automática"
                    onClick={toggleAutoSync}
                    disabled={!autoSyncLoaded || autoSyncSaving || autoSync.is_running || profile?.role !== 'admin'}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition disabled:cursor-not-allowed disabled:opacity-60 ${autoSync.is_enabled ? 'bg-[#18b44a]' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${autoSync.is_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <span className={`text-sm font-semibold ${autoSync.is_enabled ? 'text-[#2f8f17] dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
                    {autoSyncSaving ? 'Salvando...' : autoSync.is_running ? 'Sincronizando...' : autoSync.is_enabled ? 'Ativa' : 'Inativa'}
                  </span>
                  <span className="hidden h-6 w-px bg-slate-300 dark:bg-slate-700 sm:block" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">Última atualização: {autoSyncDateTime(autoSync.last_updated_at)}</span>
                </div>
              </div>

              <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#d8ebcd] bg-[#e7f8e7] px-4 py-4 text-sm leading-6 text-[#294436] dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-100">
                <Clock3 className="mt-0.5 h-6 w-6 shrink-0 text-[#168638] dark:text-emerald-300" />
                <p>
                  <strong>{autoSync.is_enabled ? 'Ativa:' : 'Ao ativar:'}</strong> sincronização geral automática de segunda a sexta, às 07h (horário de Fortaleza). {autoSync.is_enabled ? 'Enquanto estiver ativa, não faça sincronizações manuais seletivas.' : 'Enquanto estiver ativa, não será possível executar sincronizações manuais seletivas.'}
                </p>
              </div>

              {autoSync.is_running && autoSync.progress_company_name && (
                <div className="mt-4 rounded-xl border border-[#cfe8bf] bg-white/80 px-4 py-3 dark:border-emerald-900/60 dark:bg-slate-950/60">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold text-[#173c2c] dark:text-slate-100">
                      {autoSync.progress_company_name.toLocaleUpperCase('pt-BR')} | {AUTO_SYNC_TARGET_LABELS[autoSync.progress_target] || autoSync.progress_target}
                    </span>
                    {Number.isFinite(Number(autoSync.progress_total)) && autoSync.progress_unit && (
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        {Math.min(Number(autoSync.progress_current) || 0, Number(autoSync.progress_total))} de {autoSync.progress_total} {autoSync.progress_unit}
                      </span>
                    )}
                  </div>
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-[#e4efdc] dark:bg-slate-800"
                    role="progressbar"
                    aria-label="Progresso da sincronização automática"
                    aria-valuemin={0}
                    aria-valuemax={Number(autoSync.progress_total) || 0}
                    aria-valuenow={Math.min(Number(autoSync.progress_current) || 0, Number(autoSync.progress_total) || 0)}
                  >
                    <div
                      className="h-full rounded-full bg-[#18b44a] transition-[width] duration-500"
                      style={{ width: `${Number(autoSync.progress_total) > 0 ? Math.min(100, Math.round((Number(autoSync.progress_current || 0) / Number(autoSync.progress_total)) * 100)) : 0}%` }}
                    />
                  </div>
                </div>
              )}
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
                        syncBlocked={syncBlocked}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'users' && <UsersSettings />}
      </Layout>
    </>
  );
};

export default Configuracoes;
