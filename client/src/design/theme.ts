// System / Dark / Light. The preference lives in localStorage (preferences are the only thing that
// may); the resolved theme is stamped on <html data-theme>, which tokens.css keys off.

export type ThemePref = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

const KEY = 'pyron:theme';

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'system' || v === 'dark' || v === 'light') return v;
  } catch {
    // Storage blocked (private window): fall back to the default.
  }
  return 'light';
}

export function writeThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Not persisted; still applied for this page.
  }
}

function systemPrefersLight(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref !== 'system') return pref;
  return systemPrefersLight() ? 'light' : 'dark';
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

/** Re-applies the theme when the OS switches, while the preference is "system". */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export const THEME_LABEL: Record<ThemePref, string> = { system: 'System', dark: 'Dark', light: 'Light' };
export const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'dark', dark: 'light', light: 'system' };
