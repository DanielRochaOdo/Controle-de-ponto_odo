import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

const PERSISTED_FILTER_ROUTES = new Set(['/dashboard', '/registros']);
const FILTER_SELECTOR = 'input[type="month"], input[type="search"], input[type="text"], select';

const getFilterFields = () => Array.from(document.querySelectorAll(`main ${FILTER_SELECTOR}`));

const fieldKey = (field, index) => {
  const identity = field.name || field.id || field.getAttribute('placeholder') || '';
  return `${field.tagName.toLowerCase()}:${field.type || 'select'}:${identity}:${index}`;
};

const readSavedFilters = (storageKey) => {
  try {
    return JSON.parse(window.sessionStorage.getItem(storageKey) || '{}');
  } catch {
    return {};
  }
};

const setNativeFieldValue = (field, value) => {
  if (field instanceof HTMLSelectElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
};

const Layout = ({ children }) => {
  const location = useLocation();

  useEffect(() => {
    if (!PERSISTED_FILTER_ROUTES.has(location.pathname)) return undefined;

    const storageKey = `controle-ponto:filters:${location.pathname}`;
    const restored = new Set();

    const restore = () => {
      const saved = readSavedFilters(storageKey);
      getFilterFields().forEach((field, index) => {
        const key = fieldKey(field, index);
        if (restored.has(key) || saved[key] === undefined) return;

        const value = String(saved[key]);
        if (field instanceof HTMLSelectElement && !Array.from(field.options).some((option) => option.value === value)) return;

        if (field.value !== value) setNativeFieldValue(field, value);
        restored.add(key);
      });
    };

    const persist = (event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
      if (!field.matches(FILTER_SELECTOR)) return;

      const fields = getFilterFields();
      const index = fields.indexOf(field);
      if (index < 0) return;

      const saved = readSavedFilters(storageKey);
      saved[fieldKey(field, index)] = field.value;
      window.sessionStorage.setItem(storageKey, JSON.stringify(saved));
    };

    const main = document.querySelector('main');
    if (!main) return undefined;

    const frame = window.requestAnimationFrame(restore);
    const observer = new MutationObserver(restore);
    observer.observe(main, { childList: true, subtree: true });
    main.addEventListener('input', persist, true);
    main.addEventListener('change', persist, true);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      main.removeEventListener('input', persist, true);
      main.removeEventListener('change', persist, true);
    };
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-[#f7faf5] text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <Sidebar />
      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
