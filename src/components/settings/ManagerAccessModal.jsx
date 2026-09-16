import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Shield } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const entryKey = (entry) => `${entry.companyId}::${entry.departmentKey}`;

const normalizeEntries = (entries) => {
  const unique = new Map();
  (entries || []).forEach((entry) => {
    if (!entry?.companyId || !entry?.departmentKey) return;
    unique.set(entryKey(entry), {
      companyId: String(entry.companyId),
      departmentKey: String(entry.departmentKey),
    });
  });
  return [...unique.values()];
};

export const summarizeManagerAccess = (entries, catalog) => {
  const normalized = normalizeEntries(entries);
  if (!normalized.length) return 'Nenhum acesso definido';

  let departmentCount = 0;
  const companyIds = new Set();
  normalized.forEach((entry) => {
    companyIds.add(entry.companyId);
    const company = (catalog || []).find((item) => String(item.id) === entry.companyId);
    if (entry.departmentKey === '*') departmentCount += company?.departments?.length || 0;
    else departmentCount += 1;
  });

  const companiesLabel = `${companyIds.size} ${companyIds.size === 1 ? 'empresa' : 'empresas'}`;
  const departmentsLabel = `${departmentCount} ${departmentCount === 1 ? 'departamento' : 'departamentos'}`;
  return `${companiesLabel} • ${departmentsLabel}`;
};

const ManagerAccessModal = ({
  open,
  onOpenChange,
  catalog = [],
  value = [],
  onSave,
  saving = false,
  title = 'Acesso aos registros',
  description = 'Defina as empresas e os departamentos que este manager poderá visualizar.',
}) => {
  const [draft, setDraft] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    if (!open) return;
    const next = normalizeEntries(value);
    setDraft(next);
    const selectedCompanies = new Set(next.map((entry) => entry.companyId));
    if (!selectedCompanies.size && catalog[0]?.id) selectedCompanies.add(String(catalog[0].id));
    setExpanded(selectedCompanies);
  }, [open, value, catalog]);

  const selectedKeys = useMemo(() => new Set(draft.map(entryKey)), [draft]);

  const companyHasFullAccess = (companyId) => selectedKeys.has(`${companyId}::*`);
  const departmentIsSelected = (companyId, departmentId) => (
    companyHasFullAccess(companyId) || selectedKeys.has(`${companyId}::${departmentId}`)
  );

  const toggleExpanded = (companyId) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  };

  const toggleWholeCompany = (company) => {
    const companyId = String(company.id);
    setDraft((current) => {
      const withoutCompany = current.filter((entry) => entry.companyId !== companyId);
      if (companyHasFullAccess(companyId)) return withoutCompany;
      return [...withoutCompany, { companyId, departmentKey: '*' }];
    });
  };

  const toggleDepartment = (company, departmentId) => {
    const companyId = String(company.id);
    const normalizedDepartmentId = String(departmentId);

    setDraft((current) => {
      const hasFull = current.some((entry) => entry.companyId === companyId && entry.departmentKey === '*');
      if (hasFull) {
        const otherCompanies = current.filter((entry) => entry.companyId !== companyId);
        const remainingDepartments = (company.departments || [])
          .filter((department) => String(department.id) !== normalizedDepartmentId)
          .map((department) => ({ companyId, departmentKey: String(department.id) }));
        return [...otherCompanies, ...remainingDepartments];
      }

      const key = `${companyId}::${normalizedDepartmentId}`;
      if (current.some((entry) => entryKey(entry) === key)) {
        return current.filter((entry) => entryKey(entry) !== key);
      }
      return [...current, { companyId, departmentKey: normalizedDepartmentId }];
    });
  };

  const selectEverything = () => {
    setDraft(catalog.map((company) => ({
      companyId: String(company.id),
      departmentKey: '*',
    })));
    setExpanded(new Set(catalog.map((company) => String(company.id))));
  };

  const handleSave = async () => {
    await onSave(normalizeEntries(draft));
  };

  const summary = summarizeManagerAccess(draft, catalog);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden border-[#dbe9d3] p-0 dark:border-slate-800">
        <DialogHeader className="border-b border-[#e7efe2] px-6 py-5 pr-12 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eef9e7] text-[#2f8f17] dark:bg-emerald-950 dark:text-emerald-300">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-xl text-[#173c2c] dark:text-slate-100">{title}</DialogTitle>
              <DialogDescription className="mt-1">{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 border-b border-[#edf3e9] bg-[#fbfdf9] px-6 py-3 dark:border-slate-800 dark:bg-slate-950/50">
          <span className="text-sm font-medium text-[#52695d] dark:text-slate-300">{summary}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setDraft([])} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-[#173c2c] dark:hover:bg-slate-900 dark:hover:text-slate-100">
              Limpar
            </button>
            <button type="button" onClick={selectEverything} className="rounded-lg border border-[#cfe8bc] bg-white px-3 py-2 text-xs font-semibold text-[#2f8f17] transition hover:bg-[#f4faef] dark:border-slate-700 dark:bg-slate-900 dark:text-emerald-300">
              Liberar tudo
            </button>
          </div>
        </div>

        <div className="max-h-[58vh] space-y-3 overflow-y-auto px-6 py-5">
          {catalog.map((company) => {
            const companyId = String(company.id);
            const isExpanded = expanded.has(companyId);
            const fullAccess = companyHasFullAccess(companyId);
            const specificCount = draft.filter((entry) => entry.companyId === companyId && entry.departmentKey !== '*').length;
            const accessLabel = fullAccess
              ? 'Todos os departamentos'
              : specificCount
                ? `${specificCount} ${specificCount === 1 ? 'departamento' : 'departamentos'}`
                : 'Sem acesso';

            return (
              <section key={companyId} className="overflow-hidden rounded-xl border border-[#e0ead9] bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button type="button" onClick={() => toggleExpanded(companyId)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f1f8ec] text-[#2f8f17] dark:bg-emerald-950 dark:text-emerald-300">
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[#173c2c] dark:text-slate-100">{company.name}</span>
                      <span className="block text-xs text-slate-400">{accessLabel}</span>
                    </span>
                  </button>

                  <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold text-[#425c4e] dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={fullAccess}
                      onChange={() => toggleWholeCompany(company)}
                      className="h-4 w-4 rounded border-slate-300 accent-[#57D100]"
                    />
                    Empresa completa
                  </label>
                </div>

                {isExpanded && (
                  <div className="border-t border-[#edf3e9] bg-[#fbfdf9] px-4 py-4 dark:border-slate-800 dark:bg-slate-950/40">
                    <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                      {fullAccess
                        ? 'A empresa inteira está liberada. Desmarque um departamento para transformar o acesso em seleção específica.'
                        : 'Marque somente os departamentos que este manager poderá consultar.'}
                    </p>

                    {(company.departments || []).length ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {company.departments.map((department) => {
                          const checked = departmentIsSelected(companyId, String(department.id));
                          return (
                            <label key={department.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm text-[#425c4e] transition hover:border-[#dcebd2] hover:bg-white dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleDepartment(company, department.id)}
                                className="h-4 w-4 rounded border-slate-300 accent-[#57D100]"
                              />
                              <span>{department.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-[#dbe6d4] px-4 py-5 text-center text-sm text-slate-400 dark:border-slate-700">
                        Nenhum departamento sincronizado para esta empresa. Use “Empresa completa” para liberar os registros.
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}

          {!catalog.length && (
            <div className="rounded-xl border border-dashed border-[#dbe6d4] px-5 py-10 text-center text-sm text-slate-400 dark:border-slate-700">
              A Estrutura Flash ainda não possui empresas disponíveis para configurar acessos.
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-[#e7efe2] bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <button type="button" disabled={saving} onClick={() => onOpenChange(false)} className="h-10 rounded-xl border border-[#d7e5cf] px-4 text-sm font-medium text-slate-600 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300">
            Cancelar
          </button>
          <button type="button" disabled={saving} onClick={handleSave} className="h-10 rounded-xl bg-[#57D100] px-5 text-sm font-semibold text-[#064E2C] disabled:opacity-60">
            {saving ? 'Salvando...' : 'Salvar acessos'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManagerAccessModal;
