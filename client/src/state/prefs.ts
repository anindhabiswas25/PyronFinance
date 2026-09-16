import { create } from 'zustand';
import { applyTheme, readThemePref, writeThemePref, type ThemePref } from '../design/theme';

interface PrefsState {
  theme: ThemePref;
  setTheme(theme: ThemePref): void;
}

export const usePrefs = create<PrefsState>((set) => ({
  theme: readThemePref(),
  setTheme(theme) {
    writeThemePref(theme);
    applyTheme(theme);
    set({ theme });
  },
}));
