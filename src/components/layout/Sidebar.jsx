import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, FileText, LayoutGrid, LogOut, Menu, Moon, Settings, Sun, X } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { ODONTOART_LOGO } from '@/lib/brand';
import { applyTheme, getStoredTheme, saveTheme } from '@/lib/theme';

const items = [
  { icon: LayoutGrid, label: 'Dashboard', path: '/dashboard' },
  { icon: FileText, label: 'Registros', path: '/registros' },
  { icon: CalendarDays, label: 'Eventos', path: '/eventos' },
  { icon: Settings, label: 'Configurações', path: '/configuracoes' },
];

const Brand = () => (
  <div className="flex w-full items-center justify-center px-4">
    <img
      src={ODONTOART_LOGO}
      alt="Odontoart"
      className="h-auto w-full max-w-[170px] object-contain"
    />
  </div>
);

const Sidebar = () => {
  const location = useLocation();
  const { signOut, displayName } = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(getStoredTheme);

  useEffect(() => applyTheme(theme), [theme]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    saveTheme(next);
  };

  const nav = (
    <div className="flex h-full flex-col border-r border-[#dfe9d7] bg-white text-[#173c2c] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex min-h-28 items-center border-b border-[#e8f0e3] px-4 dark:border-slate-800">
        <Brand />
      </div>

      <nav className="flex-1 space-y-2 px-4 py-6">
        {items.map(({ icon: Icon, label, path }) => {
          const active = location.pathname === path;
          return (
            <Link
              key={path}
              to={path}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] font-medium transition ${
                active
                  ? 'bg-[#eaf8df] text-[#065F2F] shadow-[inset_0_0_0_1px_rgba(87,209,0,0.10)] dark:bg-emerald-950/70 dark:text-emerald-300'
                  : 'text-[#50665a] hover:bg-[#f4faef] hover:text-[#065F2F] dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? 'text-[#57D100] dark:text-emerald-400' : ''}`} strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[#e8f0e3] p-4 dark:border-slate-800">
        <div className="mb-3 rounded-xl bg-[#f7fbf4] px-4 py-3 dark:bg-slate-900">
          <p className="truncate text-xs font-medium uppercase tracking-[0.08em] text-[#829486] dark:text-slate-500">Usuário</p>
          <p className="mt-1 truncate text-sm font-semibold text-[#173c2c] dark:text-slate-100" title={displayName}>{displayName}</p>
        </div>

        <div className="space-y-1">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
            title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-[#50665a] transition hover:bg-[#f4faef] hover:text-[#065F2F] dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            <span>{theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</span>
          </button>

          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-[#50665a] transition hover:bg-[#f4faef] hover:text-[#065F2F] dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
          >
            <LogOut className="h-5 w-5" />
            Sair
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <header className="flex h-16 items-center justify-between border-b border-[#dfe9d7] bg-white px-4 dark:border-slate-800 dark:bg-slate-950 lg:hidden">
        <div className="w-36"><Brand /></div>
        <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-lg p-2 text-[#065F2F] hover:bg-[#f4faef] dark:text-emerald-300 dark:hover:bg-slate-900">
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </header>

      <aside className="fixed inset-y-0 left-0 z-50 hidden w-60 lg:block">{nav}</aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Fechar menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-950/35" />
          <aside className="relative h-full w-64 shadow-xl">{nav}</aside>
        </div>
      )}
    </>
  );
};

export default Sidebar;
