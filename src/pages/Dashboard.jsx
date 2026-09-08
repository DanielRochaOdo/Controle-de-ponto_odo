import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import {
  BarChart3,
  Check,
  ChevronRight,
  Clock3,
  Cloud,
  FileText,
  HelpCircle,
  History,
  PieChart,
  RefreshCw,
  Settings,
  Users,
  Zap,
} from 'lucide-react';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { Link } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import {
  DEFAULT_SETTINGS,
  fetchAllAttendance,
  fetchImportHistory,
  fetchLatestImport,
  importAttendanceFromFlash,
  loadAttendanceSettings,
  STATUS_LABELS,
} from '@/lib/attendanceService';
import { TimeRecordStatus } from '@/types';

const CARD = 'rounded-2xl border border-[#dfe9d7] bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900';
const INPUT = 'h-11 rounded-xl border border-[#d7e5cf] bg-white px-3 text-sm text-[#294436] outline-none transition focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

const monthRange = (month) => {
  const safeMonth = /^\d{4}-\d{2}$/.test(month || '') ? month : format(new Date(), 'yyyy-MM');
  const date = new Date(`${safeMonth}-01T12:00:00`);
  return {
    startDate: format(startOfMonth(date), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(date), 'yyyy-MM-dd'),
  };
};

const overallStatus = (record) => {
  const priority = [TimeRecordStatus.ADJUSTED, TimeRecordStatus.LATE, TimeRecordStatus.EARLY, TimeRecordStatus.LATE_EXIT];
  return priority.find((status) => record.entry_status === status || record.exit_status === status)
    || record.entry_status
    || record.exit_status;
};

const MetricCard = ({ icon: Icon, label, value, helper, color }) => (
  <div className={`${CARD} p-5`}>
    <div className="flex items-start gap-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ color, backgroundColor: `${color}16` }}>
        <Icon className="h-6 w-6" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#536b5e] dark:text-slate-400">{label}</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight text-[#173c2c] dark:text-slate-50">{value}</p>
      </div>
    </div>
    <p className="mt-4 text-xs text-[#789083] dark:text-slate-500">{helper}</p>
  </div>
);

const ApiBadge = () => (
  <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#e7f7dc] text-[#2e9e16] dark:bg-emerald-950 dark:text-emerald-300">
    <Cloud className="h-9 w-9" strokeWidth={1.8} />
    <span className="absolute bottom-1.5 rounded bg-white px-1.5 text-[9px] font-bold tracking-wide text-[#2e9e16] shadow-sm dark:bg-slate-900">API</span>
  </div>
);

const ApiBanner = () => (
  <section className="mt-6 grid gap-6 rounded-2xl border border-[#cfe8bf] bg-[linear-gradient(110deg,#f3fced_0%,#ffffff_60%,#f1f9ec_100%)] px-6 py-5 shadow-sm dark:border-emerald-900/60 dark:bg-none dark:bg-emerald-950/20 lg:grid-cols-[1fr_360px] lg:items-center">
    <div className="flex items-center gap-5">
      <ApiBadge />
      <div>
        <h2 className="text-lg font-semibold text-[#173c2c] dark:text-slate-100">Dados de ponto via API</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#647c6e] dark:text-slate-400">
          Os dados são importados manualmente da Flash por período. Selecione o mês desejado e use “Atualizar dados da API” quando precisar renovar os registros.
        </p>
      </div>
    </div>
    <div className="space-y-2 border-l border-[#cfe8bf] pl-6 text-sm text-[#647c6e] dark:border-slate-700 dark:text-slate-400">
      {['Sem upload de arquivos', 'Importação manual e segura', 'Dados atualizados somente quando solicitado'].map((text) => (
        <div key={text} className="flex items-center gap-3"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#21a653] text-white"><Check className="h-3.5 w-3.5" /></span>{text}</div>
      ))}
    </div>
  </section>
);

const WeeklyChart = ({ weeks }) => {
  const width = 620;
  const height = 220;
  const left = 42;
  const top = 20;
  const bottom = 42;
  const right = 18;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const points = weeks.map((week, index) => {
    const x = left + (chartWidth * index) / Math.max(1, weeks.length - 1);
    const y = top + chartHeight - (chartHeight * week.value) / 100;
    return { ...week, x, y };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <div className="mt-5 overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[560px] w-full" role="img" aria-label="Evolução da pontualidade por semana">
        {[0, 20, 40, 60, 80, 100].map((value) => {
          const y = top + chartHeight - (chartHeight * value) / 100;
          return <g key={value}><line x1={left} x2={width - right} y1={y} y2={y} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="1"/><text x="5" y={y + 4} className="fill-slate-400 text-[11px]">{value}%</text></g>;
        })}
        {points.length > 1 && <polyline points={polyline} fill="none" stroke="#57D100" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="5" fill="#57D100" stroke="#065F2F" strokeWidth="1.5" />
            <text x={point.x} y={Math.max(14, point.y - 12)} textAnchor="middle" className="fill-[#173c2c] text-[11px] font-semibold dark:fill-slate-200">{point.value}%</text>
            <text x={point.x} y={height - 18} textAnchor="middle" className="fill-slate-500 text-[11px] dark:fill-slate-400">{point.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
};

const StatusDistribution = ({ records, colors }) => {
  const statuses = [TimeRecordStatus.ON_TIME, TimeRecordStatus.LATE, TimeRecordStatus.LATE_EXIT, TimeRecordStatus.EARLY, TimeRecordStatus.ADJUSTED];
  const counts = statuses.map((status) => ({ status, count: records.filter((record) => overallStatus(record) === status).length }));
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  let cursor = 0;
  const segments = counts.map((item) => {
    const start = total ? (cursor / total) * 360 : 0;
    cursor += item.count;
    const end = total ? (cursor / total) * 360 : 0;
    return `${colors[item.status]} ${start}deg ${end}deg`;
  }).join(', ');

  return (
    <div className="mt-5 grid items-center gap-6 sm:grid-cols-[190px_1fr]">
      <div className="relative mx-auto h-44 w-44 rounded-full" style={{ background: total ? `conic-gradient(${segments})` : '#e5e7eb' }}>
        <div className="absolute inset-7 flex flex-col items-center justify-center rounded-full bg-white dark:bg-slate-900">
          <strong className="text-2xl text-[#173c2c] dark:text-slate-100">{total.toLocaleString('pt-BR')}</strong>
          <span className="text-xs text-slate-500">registros</span>
        </div>
      </div>
      <div className="space-y-3">
        {counts.map((item) => {
          const percentage = total ? Math.round((item.count / total) * 1000) / 10 : 0;
          return (
            <div key={item.status} className="grid grid-cols-[12px_1fr_auto_auto] items-center gap-3 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[item.status] }} />
              <span className="text-[#425c4e] dark:text-slate-300">{STATUS_LABELS[item.status]}</span>
              <strong className="text-[#173c2c] dark:text-slate-100">{item.count.toLocaleString('pt-BR')}</strong>
              <span className="w-12 text-right text-slate-400">{percentage}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const { user, displayName } = useAuth();
  const { toast } = useToast();
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [records, setRecords] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [latestImport, setLatestImport] = useState(null);
  const [imports, setImports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const range = useMemo(() => monthRange(month), [month]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [periodRecords, loadedSettings, latest, history] = await Promise.all([
        fetchAllAttendance(user.id, { ...range, employee: 'all', department: 'all', status: 'all' }),
        loadAttendanceSettings(user.id),
        fetchLatestImport(user.id),
        fetchImportHistory(user.id, 20),
      ]);
      setRecords(periodRecords);
      setSettings(loadedSettings);
      setLatestImport(latest);
      setImports(history);
    } catch (error) {
      toast({ title: 'Erro ao carregar dashboard', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [user, range.startDate, range.endDate]);

  const metrics = useMemo(() => {
    const employees = new Set(records.map((item) => item.employee_name)).size;
    const eligible = records.filter((item) => item.entry_status);
    const onTime = eligible.filter((item) => item.entry_status === TimeRecordStatus.ON_TIME).length;
    const punctuality = eligible.length ? ((onTime / eligible.length) * 100).toFixed(1).replace('.', ',') : '0,0';
    const monthImports = imports.filter((item) => item.status === 'completed' && item.finished_at?.slice(0, 7) === month).length;
    return { employees, processed: records.length, punctuality, monthImports };
  }, [records, imports, month]);

  const weeks = useMemo(() => {
    const buckets = Array.from({ length: 5 }, (_, index) => ({ label: `Sem ${index + 1}`, total: 0, onTime: 0 }));
    records.forEach((record) => {
      if (!record.entry_status) return;
      const day = Number(record.work_date?.slice(-2)) || 1;
      const index = Math.min(4, Math.floor((day - 1) / 7));
      buckets[index].total += 1;
      if (record.entry_status === TimeRecordStatus.ON_TIME) buckets[index].onTime += 1;
    });
    return buckets.map((bucket) => ({ ...bucket, value: bucket.total ? Math.round((bucket.onTime / bucket.total) * 100) : 0 }));
  }, [records]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await importAttendanceFromFlash(range.startDate, range.endDate);
      toast({ title: 'Dados atualizados', description: `${result.recordsProcessed || 0} registros processados da Flash.` });
      await load();
    } catch (error) {
      toast({ title: 'Falha na atualização', description: error.message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  const latestLabel = latestImport?.finished_at ? new Date(latestImport.finished_at).toLocaleString('pt-BR') : 'Ainda não realizada';

  return (
    <>
      <Helmet><title>Dashboard | Controle de Ponto</title></Helmet>
      <Layout>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[#173c2c] dark:text-slate-50">Dashboard</h1>
            <p className="mt-1 text-sm text-[#73877b] dark:text-slate-400">Visão geral dos dados de ponto importados via API</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} className={INPUT} />
            <button onClick={handleImport} disabled={importing} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#57D100] px-5 text-sm font-semibold text-[#064E2C] shadow-sm transition hover:bg-[#4bc000] disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${importing ? 'animate-spin' : ''}`} />
              {importing ? 'Atualizando...' : 'Atualizar dados da API'}
            </button>
            <div className="hidden min-w-[210px] items-center gap-2 text-xs text-[#6e8377] dark:text-slate-400 md:flex">
              <span className="h-2.5 w-2.5 rounded-full bg-[#21a653]" />
              <span>Última atualização manual<br/><strong className="font-medium text-[#425c4e] dark:text-slate-300">{latestLabel}</strong></span>
            </div>
            <HelpCircle className="h-5 w-5 text-slate-400" />
          </div>
        </div>

        <ApiBanner />

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Users} label="Colaboradores" value={loading ? '—' : metrics.employees} helper="no período selecionado" color="#2f8f17" />
          <MetricCard icon={FileText} label="Registros processados" value={loading ? '—' : metrics.processed.toLocaleString('pt-BR')} helper="no período selecionado" color="#57D100" />
          <MetricCard icon={Clock3} label="Pontualidade" value={loading ? '—' : `${metrics.punctuality}%`} helper="entradas classificadas como no horário" color={settings.colors[TimeRecordStatus.ON_TIME]} />
          <MetricCard icon={RefreshCw} label="Importações no mês" value={loading ? '—' : metrics.monthImports} helper="atualizações concluídas" color="#065F2F" />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.08fr_.92fr]">
          <section className={`${CARD} p-5`}>
            <div className="flex items-center justify-between gap-4">
              <div><h2 className="flex items-center gap-2 text-lg font-semibold text-[#173c2c] dark:text-slate-100"><BarChart3 className="h-5 w-5 text-[#57D100]"/>Evolução da pontualidade</h2><p className="mt-1 text-xs text-slate-500">Percentual de registros no horário por semana</p></div>
              <span className="rounded-lg border border-[#dfe9d7] px-3 py-2 text-xs text-[#647c6e] dark:border-slate-700 dark:text-slate-400">Por semana</span>
            </div>
            <WeeklyChart weeks={weeks} />
          </section>

          <section className={`${CARD} p-5`}>
            <div><h2 className="flex items-center gap-2 text-lg font-semibold text-[#173c2c] dark:text-slate-100"><PieChart className="h-5 w-5 text-[#57D100]"/>Distribuição por status</h2><p className="mt-1 text-xs text-slate-500">Total de registros do período</p></div>
            <StatusDistribution records={records} colors={settings.colors} />
          </section>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
          <section className={`${CARD} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-[#edf3e9] px-5 py-4 dark:border-slate-800">
              <div><h2 className="flex items-center gap-2 text-lg font-semibold text-[#173c2c] dark:text-slate-100"><History className="h-5 w-5 text-[#57D100]"/>Últimas importações</h2><p className="mt-1 text-xs text-slate-500">Histórico das importações realizadas via API</p></div>
              <Link to="/registros" className="flex items-center gap-1 text-sm font-medium text-[#2f8f17] hover:text-[#065F2F] dark:text-emerald-300">Ver registros <ChevronRight className="h-4 w-4"/></Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-[#f7fbf4] text-left text-xs text-[#63776b] dark:bg-slate-950 dark:text-slate-400"><tr><th className="px-5 py-3">Período</th><th className="px-5 py-3">Data e hora</th><th className="px-5 py-3">Registros</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Usuário</th></tr></thead>
                <tbody>
                  {imports.slice(0, 5).map((item) => <tr key={item.id} className="border-t border-[#edf3e9] dark:border-slate-800"><td className="px-5 py-3 text-[#425c4e] dark:text-slate-300">{item.start_date === item.end_date ? item.start_date : `${item.start_date} a ${item.end_date}`}</td><td className="px-5 py-3 text-slate-500">{item.started_at ? new Date(item.started_at).toLocaleString('pt-BR') : '—'}</td><td className="px-5 py-3 font-medium dark:text-slate-200">{item.records_processed?.toLocaleString('pt-BR') || 0}</td><td className="px-5 py-3"><span className="inline-flex items-center gap-2 text-sm"><span className={`h-2 w-2 rounded-full ${item.status === 'completed' ? 'bg-[#21a653]' : item.status === 'failed' ? 'bg-red-500' : 'bg-amber-500'}`}/>{item.status === 'completed' ? 'Concluída' : item.status === 'failed' ? 'Falhou' : 'Em andamento'}</span></td><td className="px-5 py-3 text-slate-500">{displayName}</td></tr>)}
                  {!imports.length && <tr><td colSpan="5" className="px-5 py-10 text-center text-slate-400">Nenhuma importação registrada.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${CARD} p-5`}>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[#173c2c] dark:text-slate-100"><Zap className="h-5 w-5 text-[#57D100]"/>Ações rápidas</h2>
            <p className="mt-1 text-xs text-slate-500">Acesse as principais funcionalidades</p>
            <div className="mt-5 space-y-3">
              <button onClick={handleImport} disabled={importing} className="flex w-full items-center gap-4 rounded-xl bg-[#57D100] px-4 py-4 text-left text-[#064E2C] transition hover:bg-[#4bc000] disabled:opacity-60"><RefreshCw className="h-5 w-5"/><span className="flex-1"><strong className="block text-sm">Atualizar dados da API</strong><span className="text-xs opacity-75">Importar registros do mês selecionado</span></span><ChevronRight className="h-5 w-5"/></button>
              <Link to="/registros" className="flex items-center gap-4 rounded-xl border border-[#dfe9d7] px-4 py-4 text-[#425c4e] transition hover:bg-[#f7fbf4] dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><FileText className="h-5 w-5"/><span className="flex-1"><strong className="block text-sm">Ver registros</strong><span className="text-xs text-slate-500">Consultar e filtrar registros de ponto</span></span><ChevronRight className="h-5 w-5"/></Link>
              <Link to="/configuracoes" className="flex items-center gap-4 rounded-xl border border-[#dfe9d7] px-4 py-4 text-[#425c4e] transition hover:bg-[#f7fbf4] dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><Settings className="h-5 w-5"/><span className="flex-1"><strong className="block text-sm">Configurações</strong><span className="text-xs text-slate-500">Gerenciar tolerâncias e cores</span></span><ChevronRight className="h-5 w-5"/></Link>
            </div>
          </section>
        </div>
      </Layout>
    </>
  );
};

export default Dashboard;
