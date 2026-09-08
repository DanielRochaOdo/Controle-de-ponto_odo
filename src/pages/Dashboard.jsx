import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { AlertCircle, Check, Clock3, TimerOff, Users } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { DEFAULT_SETTINGS, fetchTodayDashboard, loadAttendanceSettings, STATUS_LABELS } from '@/lib/attendanceService';
import { TimeRecordStatus } from '@/types';

const StatCard = ({ label, value, icon: Icon, color = '#065F2F' }) => (
  <div className="rounded-xl border border-[#dcefcf] bg-white p-5 shadow-sm">
    <p className="min-h-10 text-sm font-medium text-[#065F2F]">{label}</p>
    <div className="mt-3 flex items-center gap-4">
      <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ color, backgroundColor: `${color}18` }}>
        <Icon className="h-6 w-6" />
      </span>
      <strong className="text-3xl font-semibold text-[#065F2F]">{value}</strong>
    </div>
  </div>
);

const Badge = ({ status, colors }) => {
  if (!status) return <span className="text-slate-400">—</span>;
  const color = colors[status] || '#94a3b8';
  return (
    <span className="inline-flex min-w-28 justify-center rounded-md px-3 py-1 text-xs font-medium" style={{ color, backgroundColor: `${color}18` }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
};

const Dashboard = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([fetchTodayDashboard(user.id), loadAttendanceSettings(user.id)])
      .then(([data, loadedSettings]) => {
        setRecords(data);
        setSettings(loadedSettings);
      })
      .finally(() => setLoading(false));
  }, [user]);

  const metrics = useMemo(() => ({
    employees: new Set(records.map((item) => item.employee_name)).size,
    onTime: records.filter((item) => item.entry_status === TimeRecordStatus.ON_TIME).length,
    late: records.filter((item) => item.entry_status === TimeRecordStatus.LATE).length,
    lateExit: records.filter((item) => item.exit_status === TimeRecordStatus.LATE_EXIT).length,
    early: records.filter((item) => item.entry_status === TimeRecordStatus.EARLY || item.exit_status === TimeRecordStatus.EARLY).length,
  }), [records]);

  const overallStatus = (record) => {
    const priority = [TimeRecordStatus.ADJUSTED, TimeRecordStatus.LATE, TimeRecordStatus.EARLY, TimeRecordStatus.LATE_EXIT];
    return priority.find((status) => record.entry_status === status || record.exit_status === status) || record.entry_status || record.exit_status;
  };

  return (
    <>
      <Helmet><title>Dashboard | Controle de Ponto</title></Helmet>
      <Layout>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-[#065F2F]">Dashboard</h1>
          <span className="text-sm text-slate-500">{format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Total de colaboradores" value={loading ? '—' : metrics.employees} icon={Users} color="#065F2F" />
          <StatCard label="No horário" value={loading ? '—' : metrics.onTime} icon={Check} color={settings.colors[TimeRecordStatus.ON_TIME]} />
          <StatCard label="Atrasos" value={loading ? '—' : metrics.late} icon={AlertCircle} color={settings.colors[TimeRecordStatus.LATE]} />
          <StatCard label="Saída após horário" value={loading ? '—' : metrics.lateExit} icon={Clock3} color={settings.colors[TimeRecordStatus.LATE_EXIT]} />
          <StatCard label="Antecipações" value={loading ? '—' : metrics.early} icon={TimerOff} color={settings.colors[TimeRecordStatus.EARLY]} />
        </div>

        <section className="mt-6 overflow-hidden rounded-xl border border-[#dcefcf] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#edf6e7] px-6 py-5">
            <h2 className="text-xl font-semibold text-[#065F2F]">Registros de hoje</h2>
            <Link to="/registros" className="text-sm font-medium text-[#2f8f17] hover:text-[#065F2F]">Ver todos</Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-[#f7fbf4] text-left text-slate-600">
                <tr>
                  <th className="px-6 py-3 font-medium">Colaborador</th>
                  <th className="px-6 py-3 font-medium">Departamento</th>
                  <th className="px-6 py-3 font-medium">Entrada</th>
                  <th className="px-6 py-3 font-medium">Saída</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {!loading && records.slice(0, 8).map((record) => (
                  <tr key={record.id} className="border-t border-[#edf6e7]">
                    <td className="px-6 py-3 font-medium text-slate-800">{record.employee_name}</td>
                    <td className="px-6 py-3 text-slate-600">{record.department || '—'}</td>
                    <td className="px-6 py-3 text-slate-700">{record.actual_entry?.slice(0, 5) || '—'}</td>
                    <td className="px-6 py-3 text-slate-700">{record.actual_exit?.slice(0, 5) || '—'}</td>
                    <td className="px-6 py-3"><Badge status={overallStatus(record)} colors={settings.colors} /></td>
                  </tr>
                ))}
                {!loading && records.length === 0 && (
                  <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-400">Nenhum registro importado para hoje.</td></tr>
                )}
                {loading && <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-400">Carregando...</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </Layout>
    </>
  );
};

export default Dashboard;
