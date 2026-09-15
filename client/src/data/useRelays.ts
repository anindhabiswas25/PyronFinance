import { useEffect, useMemo, useState } from 'react';
import { useData } from './DataProvider';
import { relaysFor, useRelayList } from '../state/relays';
import type { RelayHealth, RelayState } from './ports';
import { MIN_RELAYS } from './relay-util';

export interface RelayView {
  urls: string[];
  states: RelayState[];
  /** Sockets open (a trading page connected). */
  connected: number;
  /** Relays answering /health. Public pages count these, because they never open sockets. */
  reachable: number;
  socketsOpen: boolean;
  /** The number the relay pill shows. */
  count: number;
  enough: boolean;
}

/** Relay list, socket status and /health every 30 s. Health checks are plain HTTP, so every page can
 *  show the count without loading the relay client. */
export function useRelays(): RelayView {
  const { relays, network } = useData();
  const lists = useRelayList((s) => s.lists);
  const urls = useMemo(() => relaysFor(lists, network.id, network.defaultRelays), [lists, network]);
  const [portStates, setPortStates] = useState<RelayState[]>(() => relays.status());
  const [health, setHealth] = useState<Record<string, RelayHealth>>({});

  useEffect(() => {
    setPortStates(relays.status());
    return relays.onStatus(setPortStates);
  }, [relays]);

  useEffect(() => {
    let alive = true;
    const check = () =>
      urls.forEach((u) =>
        void relays.health(u).then((h) => {
          if (alive) setHealth((prev) => ({ ...prev, [u]: h }));
        }),
      );
    check();
    const id = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [relays, urls]);

  return useMemo(() => {
    const byUrl = new Map(portStates.map((s) => [s.url, s]));
    const states = urls.map((url) => ({ url, connected: byUrl.get(url)?.connected ?? false, health: byUrl.get(url)?.health ?? health[url] }));
    const socketsOpen = portStates.length > 0;
    const connected = states.filter((s) => s.connected).length;
    const reachable = states.filter((s) => s.health?.ok).length;
    const count = socketsOpen ? connected : reachable;
    return { urls, states, connected, reachable, socketsOpen, count, enough: count >= MIN_RELAYS };
  }, [urls, portStates, health]);
}
