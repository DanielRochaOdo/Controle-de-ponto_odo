export const THEME_STORAGE_KEY = 'odontoart-ponto-theme';

export const getStoredTheme = () => {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const applyTheme = (theme) => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
};

export const saveTheme = (theme) => {
  if (typeof window !== 'undefined') window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
};
