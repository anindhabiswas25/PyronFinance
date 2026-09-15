// The transaction tray: every on-chain action in flight or recently finished, with its real stages.
// Persisted to sessionStorage so it follows the user across routes and reloads.

import { create } from 'zustand';
import { parse, stringify } from '../lib/bigint-json';
import type { DataSource } from '../config/env';

export type StageStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface TrayStage {
  id: string;
  label: string;
  status: StageStatus;
  detail?: string;
  startedAt?: number;
  endedAt?: number;
}

export type TrayKind = 'settle' | 'fraud-proof' | 'disclosure' | 'bond' | 'commit' | 'reveal' | 'release' | 'record';

export interface TrayEntry {
  id: string;
  kind: TrayKind;
  title: string;
  source: DataSource;
  status: 'running' | 'done' | 'failed';
  stages: TrayStage[];
  startedAt: number;
  endedAt?: number;
  txHash?: string;
  /** In-app link for the result (a receipt, a dealer). */
  href?: string;
  error?: string;
  /** The page reloaded while this was running; nothing is driving it any more. */
  interrupted?: boolean;
}

const KEY = 'pyron:tray';
const MAX_ENTRIES = 20;

function load(): TrayEntry[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const entries = raw ? parse<TrayEntry[]>(raw) : [];
    return entries.map((e) => (e.status === 'running' ? { ...e, interrupted: true } : e));
  } catch {
    return [];
  }
}

function save(entries: TrayEntry[]) {
  try {
    sessionStorage.setItem(KEY, stringify(entries));
  } catch {
    // The tray still works for this page.
  }
}

interface TrayState {
  entries: TrayEntry[];
  start(entry: Omit<TrayEntry, 'id' | 'status' | 'startedAt'> & { id?: string }): string;
  stage(id: string, stageId: string, patch: Partial<Omit<TrayStage, 'id'>>): void;
  update(id: string, patch: Partial<Omit<TrayEntry, 'id'>>): void;
  finish(id: string, patch?: Partial<Omit<TrayEntry, 'id'>>): void;
  fail(id: string, error: string, patch?: Partial<Omit<TrayEntry, 'id'>>): void;
  dismiss(id: string): void;
  clearFinished(): void;
  /** Re-reads sessionStorage (tests; a second tab never shares sessionStorage). */
  hydrate(): void;
}

export const useTray = create<TrayState>((set, get) => {
  const commit = (entries: TrayEntry[]) => {
    save(entries);
    set({ entries });
  };
  const patchEntry = (id: string, fn: (e: TrayEntry) => TrayEntry) => commit(get().entries.map((e) => (e.id === id ? fn(e) : e)));

  return {
    entries: load(),
    start(entry) {
      const id = entry.id ?? `${entry.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const next: TrayEntry = { ...entry, id, status: 'running', startedAt: Date.now() };
      commit([next, ...get().entries.filter((e) => e.id !== id)].slice(0, MAX_ENTRIES));
      return id;
    },
    stage(id, stageId, patch) {
      const now = Date.now();
      patchEntry(id, (e) => ({
        ...e,
        stages: e.stages.map((s) =>
          s.id !== stageId
            ? s
            : {
                ...s,
                ...patch,
                startedAt: patch.status === 'active' && !s.startedAt ? now : (patch.startedAt ?? s.startedAt),
                endedAt: patch.status && ['done', 'failed', 'skipped'].includes(patch.status) ? now : (patch.endedAt ?? s.endedAt),
              },
        ),
      }));
    },
    update(id, patch) {
      patchEntry(id, (e) => ({ ...e, ...patch }));
    },
    finish(id, patch) {
      patchEntry(id, (e) => ({ ...e, ...patch, status: 'done', endedAt: Date.now(), interrupted: false }));
    },
    fail(id, error, patch) {
      patchEntry(id, (e) => ({ ...e, ...patch, status: 'failed', error, endedAt: Date.now(), interrupted: false }));
    },
    dismiss(id) {
      commit(get().entries.filter((e) => e.id !== id));
    },
    clearFinished() {
      commit(get().entries.filter((e) => e.status === 'running'));
    },
    hydrate() {
      set({ entries: load() });
    },
  };
});
