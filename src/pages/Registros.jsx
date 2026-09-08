import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import {
  AlertCircle,
  Check,
  Clock3,
  Download,
  FileText,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import Layout from '@/components/layout/Layout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import {
  DEFAULT_SETTINGS,
  fetchAllAttendance,
  fetchAttendancePage,
  fetchFilterOptions,
  importAttendanceFromFlash,
  loadAttendanceSettings,
  STATUS_LABELS,
} from '@/lib/attendanceService';
import { TimeRecordStatus } from '@/types';

const PAGE_SIZE = 10;
const STATUS_OPTIONS = [
  TimeRecordStatus.ON_TIME,
  TimeRecordStatus.LATE,
  TimeRecordStatus.LATE_EXIT,
  TimeRecordStatus.EARLY,
  TimeRecordStatus.ADJUSTED,
];

const CARD = 'rounded-2xl border border-[#dfe9d7] bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900';
const FIELD = 'h-11 w-full rounded-xl border border-[#d7e5cf] bg-white px-3 text-sm text-[#294436] outline-none transition focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

const formatDate = (value) => value ? value.split('-').reverse().join('/') : '';
const formatTime = (value) => value ? String(value).slice(0, 5) : '—';

const monthRange = (month) => {
  const date = new Date(`${month}-01T12:00:00`);
  return {
    startDate: format(startOfMonth(date), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(date), 'yyyy-MM-dd'),
  };
};

const StatusBadge = ({ status, colors }) => {
  if (!status) return <span className="text-slate-400">—</span>;
  const color = colors[status] || '#64748b';
  return (
    <span className="inline-flex min-w-28 items-center justify-center gap-2 rounded-full px-3 py-1 text-xs font-medium" style={{ color, backgroundColor: `${color}18` }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {STATUS_LABELS[status] || status}
    </span>
  );
};

const MetricCard = ({ icon: Icon, label, value, helper, color }) => (
  <div className={`${CARD} p-4`}>
    <div className="flex items-start gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ color, backgroundColor: `${color}16` }}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-[#6a8073] dark:text-slate-400">{label}</p>
        <strong className="mt-1 block text-2xl text-[#173c2c] dark:text-slate-100">{value}</strong>
        <span className="text-[11px] text-slate-400">{helper}</span>
      </div>
    </div>
  </div>
);

const ApiBanner = () => (
  <section className="mt-5 grid gap-6 rounded-2xl border border-[#cfe8bf] bg-[linear-gradient(110deg,#f3fced_0%,#ffffff_60%,#f1f9ec_100%)] px-6 py-5 shadow-sm dark:border-emerald-900/60 dark:bg-none dark:bg-emerald-950/20 lg:grid-cols-[1fr_360px] lg:items-center">
    <div className="flex items-center gap-5">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#e7f7dc] text-[#2e9e16] dark:bg-emerald-950 dark:text-emerald-300">
        <RefreshCw className="h-8 w-8" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-[#173c2c] dark:text-slate-100">Dados importados manualmente via API</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#647c6e] dark:text-slate-400">
          Os registros de ponto são importados manualmente por período, sem upload de arquivos. Atualize quando necessário e aplique filtros para visualizar ou exportar as informações.
        </p>
      </div>
    </div>
    <div className="space-y-2 border-l border-[#cfe8bf] pl-6 text-sm text-[#647c6e] dark:border-slate-700 dark:text-slate-400">
      {['Sem upload de arquivos', 'Importação manual por período', 'Exportação baseada nos filtros aplicados'].map((text) => (
        <div key={text} className="flex items-center gap-3"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#21a653] text-white"><Check className="h-3.5 w-3.5" /></span>{text}</div>
      ))}
    </div>
  </section>
);

const Registros = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const initialRange = monthRange(month);
  const [filters, setFilters] = useState({ ...initialRange, search: '', employee: 'all', department: 'all', status: 'all' });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [records, setRecords] = useState([]);
  const [summaryRecords, setSummaryRecords] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState({ employees: [], departments: [] });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  useEffect(() => {
    const range = monthRange(month);
    setFilters((old) => ({ ...old, ...range }));
  }, [month]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setAppliedFilters({ ...filters });
    }, 250);
    return () => clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    if (!user) return;
    Promise.all([fetchFilterOptions(user.id), loadAttendanceSettings(user.id)])
      .then(([loadedOptions, loadedSettings]) => {
        setOptions(loadedOptions);
        setSettings(loadedSettings);
      })
      .catch((error) => toast({ title: 'Erro ao carregar filtros', description: error.message, variant: 'destructive' }));
  }, [user]);

  const loadRecords = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [{ records: pageRecords, count: total }, allFiltered] = await Promise.all([
        fetchAttendancePage(user.id, appliedFilters, page, PAGE_SIZE),
        fetchAllAttendance(user.id, appliedFilters),
      ]);
      setRecords(pageRecords);
      setCount(total);
      setSummaryRecords(allFiltered);
    } catch (error) {
      toast({ title: 'Erro ao carregar registros', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRecords(); }, [user, page, appliedFilters]);

  const metrics = useMemo(() => {
    const employees = new Set(summaryRecords.map((item) => item.employee_name)).size;
    const onTime = summaryRecords.filter((item) => item.entry_status === TimeRecordStatus.ON_TIME).length;
    const late = summaryRecords.filter((item) => item.entry_status === TimeRecordStatus.LATE).length;
    const lateExit = summaryRecords.filter((item) => item.exit_status === TimeRecordStatus.LATE_EXIT).length;
    const adjusted = summaryRecords.filter((item) => item.entry_status === TimeRecordStatus.ADJUSTED || item.exit_status === TimeRecordStatus.ADJUSTED).length;
    const percentage = (value) => summaryRecords.length ? `${((value / summaryRecords.length) * 100).toFixed(1).replace('.', ',')}%` : '0,0%';
    return { employees, total: summaryRecords.length, onTime, late, lateExit, adjusted, percentage };
  }, [summaryRecords]);

  const activeChips = useMemo(() => {
    const chips = [{ key: 'period', label: `Período: ${month.split('-').reverse().join('/')}` }];
    if (appliedFilters.search) chips.push({ key: 'search', label: `Busca: ${appliedFilters.search}` });
    if (appliedFilters.employee !== 'all') chips.push({ key: 'employee', label: `Colaborador: ${appliedFilters.employee}` });
    if (appliedFilters.department !== 'all') chips.push({ key: 'department', label: `Departamento: ${appliedFilters.department}` });
    if (appliedFilters.status !== 'all') chips.push({ key: 'status', label: `Status: ${STATUS_LABELS[appliedFilters.status]}` });
    return chips;
  }, [appliedFilters, month]);

  const clearOne = (key) => {
    if (key === 'period') return;
    setFilters((old) => ({ ...old, [key]: key === 'search' ? '' : 'all' }));
  };

  const clearFilters = () => {
    const range = monthRange(month);
    setFilters({ ...range, search: '', employee: 'all', department: 'all', status: 'all' });
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const range = monthRange(month);
      const result = await importAttendanceFromFlash(range.startDate, range.endDate);
      toast({ title: 'Dados atualizados', description: `${result.recordsProcessed || 0} registros processados da Flash.` });
      if (user) setOptions(await fetchFilterOptions(user.id));
      await loadRecords();
    } catch (error) {
      toast({ title: 'Falha na atualização', description: error.message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const allRecords = await fetchAllAttendance(user.id, appliedFilters);
      const excelModule = await import('exceljs');
      const ExcelJS = excelModule.default || excelModule;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Registros');
      worksheet.columns = [
        { header: 'Data', key: 'date', width: 13 },
        { header: 'Colaborador', key: 'employee', width: 30 },
        { header: 'Departamento', key: 'department', width: 24 },
        { header: 'Entrada prevista', key: 'scheduledEntry', width: 18 },
        { header: 'Entrada real', key: 'actualEntry', width: 15 },
        { header: 'Saída prevista', key: 'scheduledExit', width: 18 },
        { header: 'Saída real', key: 'actualExit', width: 15 },
        { header: 'Status entrada', key: 'entryStatus', width: 22 },
        { header: 'Status saída', key: 'exitStatus', width: 22 },
      ];
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FF065F2F' } };
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFFBE8' } };

      allRecords.forEach((record) => {
        const row = worksheet.addRow({
          date: formatDate(record.work_date), employee: record.employee_name, department: record.department || '',
          scheduledEntry: formatTime(record.scheduled_entry), actualEntry: formatTime(record.actual_entry),
          scheduledExit: formatTime(record.scheduled_exit), actualExit: formatTime(record.actual_exit),
          entryStatus: STATUS_LABELS[record.entry_status] || '', exitStatus: STATUS_LABELS[record.exit_status] || '',
        });
        [[8, record.entry_status], [9, record.exit_status]].forEach(([column, status]) => {
          if (!status) return;
          const hex = (settings.colors[status] || '#94a3b8').replace('#', '').toUpperCase();
          const cell = row.getCell(column);
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } };
          cell.font = { color: { argb: 'FFFFFFFF' } };
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `registros_${appliedFilters.startDate}_${appliedFilters.endDate}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: 'Erro na exportação', description: error.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const pageItems = useMemo(() => {
    const items = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    for (let value = start; value <= end; value += 1) items.push(value);
    return items;
  }, [page, totalPages]);

  return (
    <>
      <Helmet><title>Registros | Controle de Ponto</title></Helmet>
      <Layout>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[#173c2c] dark:text-slate-50">Registros</h1>
            <p className="mt-1 text-sm text-[#73877b] dark:text-slate-400">Consulte e gerencie os registros de ponto importados via API</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={FIELD} style={{ width: 160 }} />
            <button onClick={handleImport} disabled={importing} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#57D100] px-5 text-sm font-semibold text-[#064E2C] shadow-sm transition hover:bg-[#4bc000] disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${importing ? 'animate-spin' : ''}`}/>{importing ? 'Atualizando...' : 'Atualizar dados da API'}</button>
            <button onClick={handleExport} disabled={exporting || count === 0} className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#cfe0c5] bg-white px-5 text-sm font-semibold text-[#365b42] transition hover:bg-[#f7fbf4] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><Download className="h-4 w-4"/>{exporting ? 'Exportando...' : 'Exportar Excel'}</button>
          </div>
        </div>

        <ApiBanner />

        <section className={`${CARD} mt-4 p-4`}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr_1fr_auto]">
            <label><span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300"><Search className="h-4 w-4"/>Buscar</span><input value={filters.search} onChange={(event) => setFilters((old) => ({ ...old, search: event.target.value }))} placeholder="Digite o nome do colaborador..." className={FIELD}/></label>
            <label><span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300"><Users className="h-4 w-4"/>Colaborador</span><select value={filters.employee} onChange={(event) => setFilters((old) => ({ ...old, employee: event.target.value }))} className={FIELD}><option value="all">Todos os colaboradores</option>{options.employees.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300"><FileText className="h-4 w-4"/>Departamento</span><select value={filters.department} onChange={(event) => setFilters((old) => ({ ...old, department: event.target.value }))} className={FIELD}><option value="all">Todos os departamentos</option>{options.departments.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300"><Clock3 className="h-4 w-4"/>Status</span><select value={filters.status} onChange={(event) => setFilters((old) => ({ ...old, status: event.target.value }))} className={FIELD}><option value="all">Todos os status</option>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
            <button onClick={clearFilters} className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#cfe0c5] px-4 text-sm font-semibold text-[#2f8f17] transition hover:bg-[#f7fbf4] dark:border-slate-700 dark:text-emerald-300 dark:hover:bg-slate-800"><Settings className="h-4 w-4"/>Limpar filtros</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <strong className="mr-1 text-[#425c4e] dark:text-slate-300">Filtros ativos:</strong>
            {activeChips.map((chip) => <button key={chip.key} onClick={() => clearOne(chip.key)} className="rounded-full bg-[#eaf8df] px-3 py-1.5 text-[#2f8f17] dark:bg-emerald-950/70 dark:text-emerald-300">{chip.label}{chip.key !== 'period' ? '  ×' : ''}</button>)}
          </div>
        </section>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <MetricCard icon={Users} label="Colaboradores" value={metrics.employees} helper="no filtro atual" color="#2f8f17" />
          <MetricCard icon={FileText} label="Registros" value={metrics.total.toLocaleString('pt-BR')} helper="no filtro atual" color="#57D100" />
          <MetricCard icon={Clock3} label="No horário" value={metrics.onTime.toLocaleString('pt-BR')} helper={metrics.percentage(metrics.onTime)} color={settings.colors[TimeRecordStatus.ON_TIME]} />
          <MetricCard icon={AlertCircle} label="Atrasados" value={metrics.late.toLocaleString('pt-BR')} helper={metrics.percentage(metrics.late)} color={settings.colors[TimeRecordStatus.LATE]} />
          <MetricCard icon={RefreshCw} label="Saída após horário" value={metrics.lateExit.toLocaleString('pt-BR')} helper={metrics.percentage(metrics.lateExit)} color={settings.colors[TimeRecordStatus.LATE_EXIT]} />
          <MetricCard icon={Pencil} label="Ajustados" value={metrics.adjusted.toLocaleString('pt-BR')} helper={metrics.percentage(metrics.adjusted)} color={settings.colors[TimeRecordStatus.ADJUSTED]} />
        </div>

        <section className={`${CARD} mt-4 overflow-hidden`}>
          <div className="flex items-center gap-3 border-b border-[#edf3e9] px-5 py-4 dark:border-slate-800">
            <FileText className="h-5 w-5 text-[#57D100]"/>
            <div><h2 className="text-lg font-semibold text-[#173c2c] dark:text-slate-100">Registros de ponto</h2><p className="text-xs text-slate-500">Mostrando {count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} a {Math.min(page * PAGE_SIZE, count)} de {count.toLocaleString('pt-BR')} registros (filtros aplicados)</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-[#f7fbf4] text-left text-xs text-[#63776b] dark:bg-slate-950 dark:text-slate-400"><tr><th className="px-5 py-3">Nome</th><th className="px-5 py-3">Departamento</th><th className="px-5 py-3">Data</th><th className="px-5 py-3">Entrada prevista</th><th className="px-5 py-3">Entrada real</th><th className="px-5 py-3">Saída prevista</th><th className="px-5 py-3">Saída real</th><th className="px-5 py-3">Status entrada</th><th className="px-5 py-3">Status saída</th></tr></thead>
              <tbody>
                {!loading && records.map((record) => <tr key={record.id} className="border-t border-[#edf3e9] dark:border-slate-800"><td className="px-5 py-3 font-medium text-[#294436] dark:text-slate-200">{record.employee_name}</td><td className="px-5 py-3 text-slate-500">{record.department || '—'}</td><td className="px-5 py-3 text-slate-500">{formatDate(record.work_date)}</td><td className="px-5 py-3">{formatTime(record.scheduled_entry)}</td><td className="px-5 py-3">{formatTime(record.actual_entry)}</td><td className="px-5 py-3">{formatTime(record.scheduled_exit)}</td><td className="px-5 py-3">{formatTime(record.actual_exit)}</td><td className="px-5 py-3"><StatusBadge status={record.entry_status} colors={settings.colors}/></td><td className="px-5 py-3"><StatusBadge status={record.exit_status} colors={settings.colors}/></td></tr>)}
                {!loading && records.length === 0 && <tr><td colSpan="9" className="px-5 py-14 text-center text-slate-400">Nenhum registro encontrado para os filtros selecionados.</td></tr>}
                {loading && <tr><td colSpan="9" className="px-5 py-14 text-center text-slate-400">Carregando...</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[#edf3e9] px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <span className="text-sm text-slate-500">Exibindo {count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} a {Math.min(page * PAGE_SIZE, count)} de {count.toLocaleString('pt-BR')} registros</span>
            <div className="flex items-center gap-1">
              <button disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="h-9 rounded-lg border border-[#d7e5cf] px-3 disabled:opacity-40 dark:border-slate-700">‹</button>
              {pageItems.map((value) => <button key={value} onClick={() => setPage(value)} className={`h-9 min-w-9 rounded-lg border px-3 ${value === page ? 'border-[#57D100] bg-[#57D100] font-medium text-[#064E2C]' : 'border-[#d7e5cf] bg-white dark:border-slate-700 dark:bg-slate-900'}`}>{value}</button>)}
              <button disabled={page === totalPages} onClick={() => setPage((value) => value + 1)} className="h-9 rounded-lg border border-[#d7e5cf] px-3 disabled:opacity-40 dark:border-slate-700">›</button>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
};

export default Registros;
