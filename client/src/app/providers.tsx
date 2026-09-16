import { useEffect, type ReactNode } from 'react';
import { applyTheme, watchSystemTheme } from '../design/theme';
import { usePrefs } from '../state/prefs';

function ThemeSync() {
  const theme = usePrefs((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [theme]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <>
      <ThemeSync />
      {children}
    </>
  );
}
