// Shared chain subscriptions for pages. One event feed per ChainPort, started on first use and kept
// for the session, so Venue, Activity and a dealer profile read the same stream.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ChainPort, LedgerSnapshot, ProtocolEvent } from './ports';
import { useData } from './DataProvider';

export interface FeedState {
  status: 'loading' | 'ready' | 'error';
  events: ProtocolEvent[];
  height: number;
  live: boolean;
  error?: string;
}

class EventFeed {
  private state: FeedState = { status: 'loading', events: [], height: 0, live: false };
  private readonly listeners = new Set<() => void>();
  private running = false;
  private controller?: AbortController;

  constructor(private readonly chain: ChainPort) {}

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.running) void this.run();
    return () => this.listeners.delete(listener);
  };

  retry = () => {
    if (this.running) return;
    this.set({ ...this.state, status: 'loading', error: undefined });
    void this.run();
  };

  private set(next: FeedState) {
    this.state = next;
    for (const l of this.listeners) l();
  }

  private async run() {
    this.running = true;
    this.controller = new AbortController();
    const seen = new Set(this.state.events.map((e) => e.id));
    try {
      for await (const update of this.chain.events({ signal: this.controller.signal })) {
        const fresh = update.events.filter((e) => !seen.has(e.id));
        for (const e of fresh) seen.add(e.id);
        this.set({
          status: 'ready',
          events: fresh.length ? [...this.state.events, ...fresh] : this.state.events,
          height: Math.max(this.state.height, update.height),
          live: update.live || this.state.live,
        });
      }
    } catch (err) {
      this.set({ ...this.state, status: 'error', error: (err as Error).message || String(err) });
    } finally {
      this.running = false;
    }
  }
}

const feeds = new WeakMap<ChainPort, EventFeed>();

export function useEventFeed(): FeedState & { retry(): void } {
  const { chain } = useData();
  let feed = feeds.get(chain);
  if (!feed) {
    feed = new EventFeed(chain);
    feeds.set(chain, feed);
  }
  const state = useSyncExternalStore(feed.subscribe, feed.getState);
  return { ...state, retry: feed.retry };
}

export interface SnapshotState {
  status: 'loading' | 'ready' | 'error';
  snapshot?: LedgerSnapshot;
  error?: string;
  retry(): void;
}

/** The contract's ledger, refreshed every `refreshMs` and whenever `refreshKey` changes. A failed read
 *  is an error state; the page never shows stale totals as if they were current. */
export function useSnapshot(refreshKey: unknown = 0, refreshMs = 30_000): SnapshotState {
  const { chain } = useData();
  const [state, setState] = useState<Omit<SnapshotState, 'retry'>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const snapshot = await chain.snapshot();
        if (alive) setState({ status: 'ready', snapshot });
      } catch (err) {
        if (alive) setState({ status: 'error', error: (err as Error).message || String(err) });
      }
    };
    void load();
    const id = setInterval(load, refreshMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [chain, refreshKey, refreshMs, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}
