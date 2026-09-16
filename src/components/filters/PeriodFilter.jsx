import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

const formatDate = (value) => value ? value.split('-').reverse().join('/') : '';

const PeriodFilter = ({ startDate, endDate, onApply, compact = false }) => {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(startDate || '');
  const [draftEnd, setDraftEnd] = useState(endDate || '');
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setDraftStart(startDate || '');
    setDraftEnd(endDate || '');
  }, [open, startDate, endDate]);

  const validRange = Boolean(draftStart && draftEnd && draftStart <= draftEnd);

  const handleApply = () => {
    if (!validRange) return;
    onApply?.({ startDate: draftStart, endDate: draftEnd });
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {!compact && (
        <span className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300">
          <Calendar className="h-4 w-4" />
          Período
        </span>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex h-11 items-center justify-between gap-3 rounded-xl border border-[#d7e5cf] bg-white px-3 text-left text-sm text-[#294436] outline-none transition hover:border-[#b8d7a5] focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 ${compact ? 'w-[255px] max-w-full' : 'w-full'}`}
        aria-expanded={open}
        aria-label="Selecionar período"
      >
        <span className="flex min-w-0 items-center gap-2">
          {compact && <Calendar className="h-4 w-4 shrink-0 text-[#2f8f17] dark:text-emerald-300" />}
          <span className="truncate">{formatDate(startDate)} até {formatDate(endDate)}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className={`absolute left-0 z-50 w-[320px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[#cfe0c5] bg-white p-4 shadow-[0_18px_45px_rgba(23,60,44,0.16)] dark:border-slate-700 dark:bg-slate-900 ${compact ? 'top-[52px]' : 'top-[74px]'}`}>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[#425c4e] dark:text-slate-300">De</span>
              <input
                type="date"
                value={draftStart}
                onChange={(event) => setDraftStart(event.target.value)}
                max={draftEnd || undefined}
                className="h-11 w-full rounded-xl border border-[#d7e5cf] bg-white px-3 text-sm text-[#294436] outline-none transition focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[#425c4e] dark:text-slate-300">Até</span>
              <input
                type="date"
                value={draftEnd}
                onChange={(event) => setDraftEnd(event.target.value)}
                min={draftStart || undefined}
                className="h-11 w-full rounded-xl border border-[#d7e5cf] bg-white px-3 text-sm text-[#294436] outline-none transition focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[#edf3e9] pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setDraftStart('');
                setDraftEnd('');
              }}
              className="h-9 px-2 text-sm font-semibold text-[#2f8f17] transition hover:text-[#065F2F] dark:text-emerald-300"
            >
              Limpar
            </button>

            <button
              type="button"
              onClick={handleApply}
              disabled={!validRange}
              className="h-9 rounded-xl bg-[#57D100] px-4 text-sm font-semibold text-[#064E2C] transition hover:bg-[#4cc000] disabled:cursor-not-allowed disabled:opacity-40"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PeriodFilter;
