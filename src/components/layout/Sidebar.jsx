import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FileText, LayoutDashboard, LogOut, Menu, Settings, X } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { ODONTOART_LOGO } from '@/lib/brand';

const items = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: FileText, label: 'Registros', path: '/registros' },
  { icon: Settings, label: 'Configurações', path: '/configuracoes' },
];

const Brand = () => (
  <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
    <img src={ODONTOART_LOGO} alt="Odontoart" className="h-12 w-auto max-w-[170px] object-contain" />
  </div>
);

const Sidebar = () => {
  const location = useLocation();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const nav = (
    <div className="flex h-full flex-col bg-[#065F2F] text-white">
      <div className="flex h-28 items-center justify-center border-b border-white/10 px-5">
        <Brand />
      </div>

      <nav className="flex-1 space-y-2 p-4">
        {items.map(({ icon: Icon, label, path }) => {
          const active = location.pathname === path;
          return (
            <Link
              key={path}
              to={path}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition ${
                active ? 'bg-[#57D100] text-[#064E2C] shadow-sm' : 'text-white/85 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm text-white/90 transition hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-5 w-5" />
          Sair
        </button>
      </div>
    </div>
  );

  return (
    <>
      <header className="flex h-20 items-center justify-between bg-[#065F2F] px-4 text-white lg:hidden">
        <Brand />
        <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-lg p-2 hover:bg-white/10">
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </header>

      <aside className="fixed inset-y-0 left-0 z-50 hidden w-56 lg:block">{nav}</aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Fechar menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-950/30" />
          <aside className="relative h-full w-64 shadow-xl">{nav}</aside>
        </div>
      )}
    </>
  );
};

export default Sidebar;
