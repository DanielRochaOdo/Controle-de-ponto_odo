import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import {
  Building,
  CalendarDays,
  Check,
  Clock3,
  Download,
  FileText,
  HeartPulse,
  RefreshCw,
  Search,
  Settings,
  Tag,
  Users,
} from 'lucide-react';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import Layout from '@/components/layout/Layout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import {
  fetchAllEvents,
  fetchEventFilterOptions,
  fetchEventsPage,
  importEventsFromFlash,
} from '@/lib/eventService';

const PAGE_SIZE = 10;
const CARD = 'rounded-2xl border border-[#dfe9d7] bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900';
const FIELD = 'h-11 w-full rounded-xl border border-[#d7e5cf] bg-white px-3 text-sm text-[#294436] outline-none transition focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
const PERIOD_OPTIONS = [
  { value: 'ALL_DAY', label: 'Dia Todo' },
  { value: 'PERIOD', label: 'Período' },
  { value: 'HOURS', label: 'Horas' },
];

const formatDate = (value) => value ? String(value).slice(0, 10).split('-').reverse().join('/') : '—';
const monthRange = (month) => {
  const date = new Date(`${month}-01T12:00:00`);
  return {
    startDate: format(startOfMonth(date), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(date), 'yyyy-MM-dd'),
  };
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
        <CalendarDays className="h-8 w-8" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-[#173c2c] dark:text-slate-100">Eventos importados manualmente via API</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#647c6e] dark:text-slate-400">
          A competência selecionada é consultada em todas as empresas Flash configuradas, com uma chamada mensal por empresa.
        </p>
      </div>
    </div>
    <div className="space-y-2 border-l border-[#cfe8bf] pl-6 text-sm text-[#647c6e] dark:border-slate-700 dark:text-slate-400">
      {['Nome e departamento pela estrutura sincronizada', 'CID, quantidade e justificativa vindos do evento', 'Exportação baseada nos filtros aplicados'].map((text) => (
        <div key={text} className="flex items-center gap-3"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#21a653] text-white"><Check className="h-3.5 w-3.5" /></span>{text}</div>
      ))}
    </div>
  </section>
);

const Eventos = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const initialRange = monthRange(month);
  const [filters, setFilters] = useState({
    ...initialRange,
    search: '',
    company: 'all',
    employee: 'all',
    department: 'all',
    reason: 'all',
    periodType: 'all',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [records, setRecords] = useState([]);
  const [summaryRecords, setSummaryRecords] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState({ companies: [], employees: [], departments: [], reasons: [] });
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

  const loadOptions = async () => {
    if (!user) return;
    try {
      setOptions(await fetchEventFilterOptions(user.id));
    } catch (error) {
      toast({ title: 'Erro ao carregar filtros', description: error.message, variant: 'destructive' });
    }
  };

  useEffect(() => { loadOptions(); }, [user]);

  const loadRecords = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [{ records: pageRecords, count: total }, allFiltered] = await Promise.all([
        fetchEventsPage(user.id, appliedFilters, page, PAGE_SIZE),
        fetchAllEvents(user.id, appliedFilters),
      ]);
      setRecords(pageRecords);
      setCount(total);
      setSummaryRecords(allFiltered);
    } catch (error) {
      toast({ title: 'Erro ao carregar eventos', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRecords(); }, [user, page, appliedFilters]);

  const metrics = useMemo(() => {
    const employees = new Set(summaryRecords.map((item) => `${item.flash_company_id || ''}:${item.flash_employee_id || item.employee_name}`)).size;
    const allDay = summaryRecords.filter((item) => item.period_type === 'ALL_DAY').length;
    const periods = summaryRecords.filter((item) => item.period_type === 'PERIOD').length;
    const hours = summaryRecords.filter((item) => item.period_type === 'HOURS').length;
    const withCid = summaryRecords.filter((item) => Array.isArray(item.cids) && item.cids.length > 0).length;
    return { employees, total: summaryRecords.length, allDay, periods, hours, withCid };
  }, [summaryRecords]);

  const activeChips = useMemo(() => {
    const chips = [{ key: 'period', label: `Período: ${month.split('-').reverse().join('/')}` }];
    if (appliedFilters.search) chips.push({ key: 'search', label: `Busca: ${appliedFilters.search}` });
    if (appliedFilters.company !== 'all') chips.push({ key: 'company', label: `Filial: ${appliedFilters.company}` });
    if (appliedFilters.employee !== 'all') chips.push({ key: 'employee', label: `Colaborador: ${appliedFilters.employee}` });
    if (appliedFilters.department !== 'all') chips.push({ key: 'department', label: `Departamento: ${appliedFilters.department}` });
    if (appliedFilters.reason !== 'all') chips.push({ key: 'reason', label: `Motivo: ${appliedFilters.reason}` });
    if (appliedFilters.periodType !== 'all') chips.push({ key: 'periodType', label: `Qtde: ${PERIOD_OPTIONS.find((item) => item.value === appliedFilters.periodType)?.label || appliedFilters.periodType}` });
    return chips;
  }, [appliedFilters, month]);

  const clearOne = (key) => {
    if (key === 'period') return;
    setFilters((old) => ({ ...old, [key]: key === 'search' ? '' : 'all' }));
  };

  const clearFilters = () => {
    const range = monthRange(month);
    setFilters({ ...range, search: '', company: 'all', employee: 'all', department: 'all', reason: 'all', periodType: 'all' });
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await importEventsFromFlash(month);
      const unknown = result.unknownReasonIds?.length
        ? ` ${result.unknownReasonIds.length} reasonId(s) novo(s) ficaram identificados pelo código para revisão.`
        : '';
      toast({ title: 'Eventos atualizados', description: `${result.eventsProcessed || 0} eventos processados em ${result.companiesProcessed || 0} empresas.${unknown}` });
      await loadOptions();
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
      const allRecords = await fetchAllEvents(user.id, appliedFilters);
      const excelModule = await import('exceljs');
      const ExcelJS = excelModule.default || excelModule;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Eventos');
      worksheet.columns = [
        { header: 'Nome', key: 'name', width: 34 },
        { header: 'Departamento', key: 'department', width: 24 },
        { header: 'Filial', key: 'company', width: 36 },
        { header: 'Motivo', key: 'reason', width: 30 },
        { header: 'Descrição', key: 'description', width: 75 },
        { header: 'Justificativa', key: 'justification', width: 35 },
        { header: 'CID', key: 'cid', width: 20 },
        { header: 'Data Inicio', key: 'date', width: 15 },
        { header: 'Qtde', key: 'quantity', width: 14 },
      ];
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FF065F2F' } };
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFFBE8' } };
      worksheet.getColumn('description').alignment = { wrapText: true, vertical: 'top' };
      worksheet.getColumn('justification').alignment = { wrapText: true, vertical: 'top' };

      allRecords.forEach((record) => worksheet.addRow({
        name: record.employee_name || '',
        department: record.department || '',
        company: record.company_name || '',
        reason: record.reason_name || '',
        description: record.reason_description || '',
        justification: record.justification || '',
        cid: Array.isArray(record.cids) ? record.cids.join(', ') : '',
        date: formatDate(record.event_date),
        quantity: record.quantity_label || '',
      }));

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `eventos_${appliedFilters.startDate}_${appliedFilters.endDate}.xlsx`;
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
      <Helmet><title>Eventos | Controle de Ponto</title></Helmet>
      <Layout>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[#173c2c] dark:text-slate-50">Eventos</h1>
            <p className="mt-1 text-sm text-[#73877b] dark:text-slate-400">Consulte eventos, afastamentos e ocorrências importadas do Controle de Jornada da Flash</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input type="month" min="2026-01" value={month} onChange={(event) => setMonth(event.target.value)} className={FIELD} style={{ width: 160 }} />
            <button onClick={handleImport} disabled={importing} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#57D100] px-5 text-sm font-semibold text-[#064E2C] shadow-sm transition hover:bg-[#4bc000] disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${importing ? 'animate-spin' : ''}`}/>{importing ? 'Atualizando...' : 'Atualizar dados da API'}</button>
            <button onClick={handleExport} disabled={exporting || count === 0} className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#cfe0c5] bg-white px-5 text-sm font-semibold text-[#365b42] transition hover:bg-[#f7fbf4] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><Download className="h-4 w-4"/>{exporting ? 'Exportando...' : 'Exportar Excel'}</button>
          </div>
        </div>

        <ApiBanner />

        <section className={`${CARD} mt-4 p-4`}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[1.1fr_1fr_1fr_1fr_1fr_1fr_auto]">
            <label><span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300"><Search className="h-4 w-4"/>Buscar</span><input value={filters.search} onChange={(event) => setFilters((old) => ({ ...old, search: event.target.value }))} placeholder="Digite o nome do colaborador..." className={FIELD}/></label>
            <label><span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300"><Building className="h-4 w-4"/>Filial</span><select value={filters.company} onChange={(event) => setFilters((old) => ({ ...old, company: event.target.value }))} className={FIELD}><option value="all">Todas as filiais</option>{options.companies.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300"><Users className="h-4 w-4"/>Colaborador</span><select value={filters.employee} onChange={(event) => setFilters((old) => ({ ...old, employee: event.target.value }))} className={FIELD}><option value="all">Todos os colaboradores</option>{options.employees.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300"><FileText className="h-4 w-4"/>Departamento</span><select value={filters.department} onChange={(event) => setFilters((old) => ({ ...old, department: event.target.value }))} className={FIELD}><option value="all">Todos os departamentos</option>{options.departments.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300"><Tag className="h-4 w-4"/>Motivo</span><select value={filters.reason} onChange={(event) => setFilters((old) => ({ ...old, reason: event.target.value }))} className={FIELD}><option value="all">Todos os motivos</option>{options.reasons.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300"><Clock3 className="h-4 w-4"/>Qtde</span><select value={filters.periodType} onChange={(event) => setFilters((old) => ({ ...old, periodType: event.target.value }))} className={FIELD}><option value="all">Todos os tipos</option>{PERIOD_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <button onClick={clearFilters} className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#cfe0c5] px-4 text-sm font-semibold text-[#2f8f17] transition hover:bg-[#f7fbf4] dark:border-slate-700 dark:text-emerald-300 dark:hover:bg-slate-800"><Settings className="h-4 w-4"/>Limpar filtros</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <strong className="mr-1 text-[#425c4e] dark:text-slate-300">Filtros ativos:</strong>
            {activeChips.map((chip) => <button key={chip.key} onClick={() => clearOne(chip.key)} className="rounded-full bg-[#eaf8df] px-3 py-1.5 text-[#2f8f17] dark:bg-emerald-950/70 dark:text-emerald-300">{chip.label}{chip.key !== 'period' ? '  ×' : ''}</button>)}
          </div>
        </section>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <MetricCard icon={Users} label="Colaboradores" value={metrics.employees} helper="no filtro atual" color="#2f8f17" />
          <MetricCard icon={CalendarDays} label="Eventos" value={metrics.total.toLocaleString('pt-BR')} helper="no filtro atual" color="#57D100" />
          <MetricCard icon={FileText} label="Dia Todo" value={metrics.allDay.toLocaleString('pt-BR')} helper="eventos de dia inteiro" color="#065F2F" />
          <MetricCard icon={CalendarDays} label="Períodos" value={metrics.periods.toLocaleString('pt-BR')} helper="eventos com vários dias" color="#4f46e5" />
          <MetricCard icon={Clock3} label="Por horas" value={metrics.hours.toLocaleString('pt-BR')} helper="eventos parciais" color="#d97706" />
          <MetricCard icon={HeartPulse} label="Com CID" value={metrics.withCid.toLocaleString('pt-BR')} helper="eventos com CID informado" color="#dc2626" />
        </div>

        <section className={`${CARD} mt-4 overflow-hidden`}>
          <div className="flex items-center gap-3 border-b border-[#edf3e9] px-5 py-4 dark:border-slate-800">
            <CalendarDays className="h-5 w-5 text-[#57D100]"/>
            <div><h2 className="text-lg font-semibold text-[#173c2c] dark:text-slate-100">Eventos</h2><p className="text-xs text-slate-500">Mostrando {count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} a {Math.min(page * PAGE_SIZE, count)} de {count.toLocaleString('pt-BR')} eventos (filtros aplicados)</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1580px] text-sm">
              <thead className="bg-[#f7fbf4] text-left text-xs text-[#63776b] dark:bg-slate-950 dark:text-slate-400">
                <tr><th className="px-5 py-3">Nome</th><th className="px-5 py-3">Departamento</th><th className="px-5 py-3">Filial</th><th className="px-5 py-3">Motivo</th><th className="px-5 py-3">Descrição</th><th className="px-5 py-3">Justificativa</th><th className="px-5 py-3">CID</th><th className="px-5 py-3">Data Inicio</th><th className="px-5 py-3">Qtde</th></tr>
              </thead>
              <tbody>
                {!loading && records.map((record) => (
                  <tr key={record.id} className="border-t border-[#edf3e9] align-top dark:border-slate-800">
                    <td className="px-5 py-3 font-medium text-[#294436] dark:text-slate-200">{record.employee_name || '—'}</td>
                    <td className="px-5 py-3 text-slate-500">{record.department || '—'}</td>
                    <td className="px-5 py-3 text-xs font-medium text-[#065F2F] dark:text-emerald-300">{record.company_name || '—'}</td>
                    <td className="px-5 py-3 font-medium">{record.reason_name || '—'}</td>
                    <td className="max-w-[420px] whitespace-normal px-5 py-3 text-slate-500">{record.reason_description || '—'}</td>
                    <td className="max-w-[300px] whitespace-normal px-5 py-3 text-slate-500">{record.justification || '—'}</td>
                    <td className="px-5 py-3">{Array.isArray(record.cids) && record.cids.length ? record.cids.join(', ') : '—'}</td>
                    <td className="px-5 py-3 text-slate-500">{formatDate(record.event_date)}</td>
                    <td className="px-5 py-3 font-medium">{record.quantity_label || '—'}</td>
                  </tr>
                ))}
                {!loading && records.length === 0 && <tr><td colSpan="9" className="px-5 py-14 text-center text-slate-400">Nenhum evento encontrado para os filtros selecionados.</td></tr>}
                {loading && <tr><td colSpan="9" className="px-5 py-14 text-center text-slate-400">Carregando...</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[#edf3e9] px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <span className="text-sm text-slate-500">Exibindo {count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} a {Math.min(page * PAGE_SIZE, count)} de {count.toLocaleString('pt-BR')} eventos</span>
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

export default Eventos;
