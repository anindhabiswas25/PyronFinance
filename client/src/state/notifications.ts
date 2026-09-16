// The notification centre's entries: what a running trade needs from the user ("needs you") and what
// has happened ("updates"). features/trade/notify.ts derives the full set from state; `sync` reconciles
// it here, so an entry changes in place instead of piling up, and a "needs you" entry resolves by
// itself once the state moves past it. Persisted to sessionStorage like the tray. An entry's text may
// carry a price: it is on this device only, never sent anywhere.

import { create } from 'zustand';
import { parse, stringify } from '../lib/bigint-json';
import type { Tone } from '../design/tone';
import type { TradeView } from './rfq';

/** Plain data, not callbacks, so an entry's buttons still work after a reload. */
export type NoticeAction =
  | { type: 'open-trade'; view?: TradeView; quoteId?: string }
  | { type: 'retry-quote'; quoteId: string }
  | { type: 'fraud-proof'; quoteId: string }
  | { type: 'save-evidence' }
  | { type: 'open-receipt'; quoteId: string }
  | { type: 'attach-note'; quoteId: string }
  | { type: 'ask-again' }
  | { type: 'manage-relays' }
  | { type: 'connect-wallet' }
  | { type: 'become-dealer' };

export interface NoticeButton {
  label: string;
  action: NoticeAction;
  primary?: boolean;
}

export interface Notice {
  key: string;
  /** "action" needs the user and resolves when it no longer does; "update" is history. */
  kind: 'action' | 'update';
  tone: Tone;
  title: string;
  body?: string;
  actions: NoticeButton[];
  /** Worth a toast when it appears, if the user isn't on the screen that already shows it. */
  toast?: boolean;
  createdAt: number;
  updatedAt: number;
  read: boolean;
  resolved: boolean;
}

export type NoticeDraft = Omit<Notice, 'createdAt' | 'updatedAt' | 'read' | 'resolved'>;

const KEY = 'pyron:notices';
const MAX_ENTRIES = 50;

interface Persisted {
  entries: Notice[];
  dismissed: string[];
}

function load(): Persisted {
  try {
    const raw = sessionStorage.getItem(KEY);
    const saved = raw ? parse<Persisted>(raw) : undefined;
    return { entries: saved?.entries ?? [], dismissed: saved?.dismissed ?? [] };
  } catch {
    return { entries: [], dismissed: [] };
  }
}

function save(p: Persisted) {
  try {
    sessionStorage.setItem(KEY, stringify(p));
  } catch {
    // The centre still works for this page.
  }
}

const sameContent = (a: NoticeDraft, b: NoticeDraft) =>
  a.kind === b.kind && a.tone === b.tone && a.title === b.title && a.body === b.body && JSON.stringify(a.actions) === JSON.stringify(b.actions);

interface NotificationState extends Persisted {
  /** Reconciles every entry whose key starts with `prefix` against `drafts`. Returns the entries that
   *  appeared (new, or back after resolving), for the caller to toast. */
  sync(prefix: string, drafts: NoticeDraft[], nowMs?: number): Notice[];
  /** Hides an entry until its state goes away; a "needs you" entry doesn't come straight back. */
  dismiss(key: string): void;
  markAllRead(): void;
  clearHistory(): void;
  hydrate(): void;
}

export const useNotifications = create<NotificationState>((set, get) => {
  const commit = (p: Persisted) => {
    save(p);
    set(p);
  };

  return {
    ...load(),
    sync(prefix, drafts, nowMs = Date.now()) {
      const { entries, dismissed } = get();
      const wanted = new Map(drafts.map((d) => [d.key, d]));
      const appeared: Notice[] = [];
      let changed = false;

      // A dismissal lasts only while its state does.
      const stillDismissed = dismissed.filter((k) => !k.startsWith(prefix) || wanted.has(k));
      if (stillDismissed.length !== dismissed.length) changed = true;

      const next = entries.map((e) => {
        if (!e.key.startsWith(prefix)) return e;
        const d = wanted.get(e.key);
        if (!d) {
          if (e.kind !== 'action' || e.resolved) return e;
          changed = true;
          return { ...e, resolved: true, updatedAt: nowMs };
        }
        if (!e.resolved && sameContent(e, d)) return e;
        changed = true;
        const updated: Notice = { ...e, ...d, updatedAt: nowMs, read: false, resolved: false };
        if (e.resolved) appeared.push(updated);
        return updated;
      });

      const known = new Set(entries.map((e) => e.key));
      const created: Notice[] = [];
      for (const d of drafts) {
        if (known.has(d.key) || stillDismissed.includes(d.key)) continue;
        const n: Notice = { ...d, createdAt: nowMs, updatedAt: nowMs, read: false, resolved: false };
        created.push(n);
        appeared.push(n);
      }
      if (created.length) changed = true;
      if (!changed) return [];

      // Newest first by creation, so an entry never jumps when it updates.
      const merged = [...created.reverse(), ...next].slice(0, MAX_ENTRIES);
      commit({ entries: merged, dismissed: stillDismissed });
      return appeared.filter((n) => merged.includes(n) && !stillDismissed.includes(n.key));
    },
    dismiss(key) {
      const { entries, dismissed } = get();
      const entry = entries.find((e) => e.key === key);
      commit({
        entries: entries.filter((e) => e.key !== key),
        dismissed: entry && entry.kind === 'action' && !entry.resolved ? [...dismissed, key] : dismissed,
      });
    },
    markAllRead() {
      const { entries, dismissed } = get();
      if (entries.every((e) => e.read)) return;
      commit({ entries: entries.map((e) => (e.read ? e : { ...e, read: true })), dismissed });
    },
    clearHistory() {
      const { entries, dismissed } = get();
      commit({ entries: entries.filter((e) => e.kind === 'action' && !e.resolved), dismissed });
    },
    hydrate() {
      set(load());
    },
  };
});

/** Entries that still need the user. */
export const needsYou = (entries: readonly Notice[]) => entries.filter((e) => e.kind === 'action' && !e.resolved);
