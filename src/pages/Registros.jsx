import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Download, RefreshCw, Search } from 'lucide-react';
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

const PAGE_SIZE = 50;
const STATUS_OPTIONS = [
  TimeRecordStatus.ON_TIME,
  TimeRecordStatus.LATE,
  TimeRecordStatus.LATE_EXIT,
  TimeRecordStatus.EARLY,
  TimeRecordStatus.ADJUSTED,
];

const formatDate = (value) => value ? value.split('-').reverse().join('/') : '';
const formatTime = (value) => value ? String(value).slice(0, 5) : '—';

const StatusBadge = ({ status, colors }) => {
  if (!status) return <span className="text-slate-400">—</span>;
  const color = colors[status] || '#64748b';
  return <span className="inline-flex min-w-28 justify-center rounded-md px-3 py-1 text-xs font-medium" style={{ color, backgroundColor: `${color}18` }}>{STATUS_LABELS[status] || status}</span>;
};

const Registros = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
    employee: 'all',
    department: 'all',
    status: 'all',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [records, setRecords] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState({ employees: [], departments: [] });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const loadRecords = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { records: data, count: total } = await fetchAttendancePage(user.id, appliedFilters, page, PAGE_SIZE);
      setRecords(data);
      setCount(total);
    } catch (error) {
      toast({ title: 'Erro ao carregar registros', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    Promise.all([fetchFilterOptions(user.id), loadAttendanceSettings(user.id)])
      .then(([loadedOptions, loadedSettings]) => {
        setOptions(loadedOptions);
        setSettings(loadedSettings);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => { loadRecords(); }, [user, page, appliedFilters]);

  const applyFilters = () => {
    setPage(1);
    setAppliedFilters({ ...filters });
  };

  const clearFilters = () => {
    const next = {
      startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
      endDate: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
      employee: 'all', department: 'all', status: 'all',
    };
    setFilters(next);
    setPage(1);
    setAppliedFilters(next);
  };

  const handleImport = async () => {
    if (!filters.startDate || !filters.endDate) return;
    setImporting(true);
    try {
      const result = await importAttendanceFromFlash(filters.startDate, filters.endDate);
      toast({ title: 'Dados atualizados', description: `${result.recordsProcessed} registros processados da Flash.` });
      setAppliedFilters({ ...filters });
      setPage(1);
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
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF4F8' } };

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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Registros</h1>
            <p className="mt-1 text-sm text-slate-500">Consulte, filtre e exporte os registros de ponto.</p>
          </div>
          <button onClick={handleImport} disabled={importing} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#0d4d82] px-5 font-medium text-white shadow-sm transition hover:bg-[#0b426f] disabled:opacity-60">
            <RefreshCw className={`h-5 w-5 ${importing ? 'animate-spin' : ''}`} />
            {importing ? 'Atualizando...' : 'Atualizar dados da Flash'}
          </button>
        </div>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <label className="xl:col-span-2"><span className="mb-2 block text-sm font-medium">Período</span><div className="flex items-center gap-2"><input type="date" value={filters.startDate} onChange={(e) => setFilters((old) => ({ ...old, startDate: e.target.value }))} className="h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3"/><span className="text-sm text-slate-400">até</span><input type="date" value={filters.endDate} onChange={(e) => setFilters((old) => ({ ...old, endDate: e.target.value }))} className="h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3"/></div></label>
            <label><span className="mb-2 block text-sm font-medium">Colaborador</span><select value={filters.employee} onChange={(e) => setFilters((old) => ({ ...old, employee: e.target.value }))} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="all">Todos</option>{options.employees.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span className="mb-2 block text-sm font-medium">Departamento</span><select value={filters.department} onChange={(e) => setFilters((old) => ({ ...old, department: e.target.value }))} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="all">Todos</option>{options.departments.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span className="mb-2 block text-sm font-medium">Status</span><select value={filters.status} onChange={(e) => setFilters((old) => ({ ...old, status: e.target.value }))} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="all">Todos</option>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button onClick={applyFilters} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0d4d82] px-5 font-medium text-white"><Search className="h-4 w-4"/>Buscar</button>
            <button onClick={clearFilters} className="h-11 rounded-lg border border-slate-300 px-5 font-medium text-slate-600 hover:bg-slate-50">Limpar filtros</button>
            <button onClick={handleExport} disabled={exporting || count === 0} className="ml-auto inline-flex h-11 items-center gap-2 rounded-lg bg-slate-100 px-5 font-medium text-[#0b3154] hover:bg-slate-200 disabled:opacity-50"><Download className="h-5 w-5"/>{exporting ? 'Exportando...' : 'Exportar Excel'}</button>
          </div>
        </section>

        <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4"><strong className="text-[#0b3154]">{count.toLocaleString('pt-BR')} registros encontrados</strong></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-5 py-3">Data</th><th className="px-5 py-3">Colaborador</th><th className="px-5 py-3">Departamento</th><th className="px-5 py-3">Entrada prevista</th><th className="px-5 py-3">Entrada real</th><th className="px-5 py-3">Saída prevista</th><th className="px-5 py-3">Saída real</th><th className="px-5 py-3">Status entrada</th><th className="px-5 py-3">Status saída</th></tr></thead>
              <tbody>
                {!loading && records.map((record) => <tr key={record.id} className="border-t border-slate-100"><td className="px-5 py-3">{formatDate(record.work_date)}</td><td className="px-5 py-3 font-medium text-slate-800">{record.employee_name}</td><td className="px-5 py-3 text-slate-600">{record.department || '—'}</td><td className="px-5 py-3">{formatTime(record.scheduled_entry)}</td><td className="px-5 py-3">{formatTime(record.actual_entry)}</td><td className="px-5 py-3">{formatTime(record.scheduled_exit)}</td><td className="px-5 py-3">{formatTime(record.actual_exit)}</td><td className="px-5 py-3"><StatusBadge status={record.entry_status} colors={settings.colors}/></td><td className="px-5 py-3"><StatusBadge status={record.exit_status} colors={settings.colors}/></td></tr>)}
                {!loading && records.length === 0 && <tr><td colSpan="9" className="px-5 py-14 text-center text-slate-400">Nenhum registro encontrado para os filtros selecionados.</td></tr>}
                {loading && <tr><td colSpan="9" className="px-5 py-14 text-center text-slate-400">Carregando...</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-slate-500">Exibindo {count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} a {Math.min(page * PAGE_SIZE, count)} de {count.toLocaleString('pt-BR')} registros</span>
            <div className="flex items-center gap-1"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="h-9 rounded-md border px-3 disabled:opacity-40">‹</button>{pageItems.map((value) => <button key={value} onClick={() => setPage(value)} className={`h-9 min-w-9 rounded-md border px-3 ${value === page ? 'border-blue-600 bg-blue-600 text-white' : 'bg-white'}`}>{value}</button>)}<button disabled={page === totalPages} onClick={() => setPage((value) => value + 1)} className="h-9 rounded-md border px-3 disabled:opacity-40">›</button></div>
          </div>
        </section>
      </Layout>
    </>
  );
};

export default Registros;
