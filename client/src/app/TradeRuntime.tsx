// Runs the trade from the shell, so it keeps going on every page, not only while /trade is open:
//
//   attach   the stored trade for these ports (data source + network);
//   engine   loaded (and the SDK with it) only once a trade is active or /trade is open, then kept
//            for these ports; its loop collects quotes and opens reveals wherever the user is;
//   notify   the trade state as notification-centre entries, with a toast only when the user is off
//            /trade, where the screen already shows it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import type { DataPorts, RelayState } from '../data/ports';
import { toast } from '../design/primitives';
import { tradeNotices, TRADE_NOTICE_PREFIX } from '../features/trade/notify';
import { useNotifications } from '../state/notifications';
import { useOverlays } from '../state/overlays';
import { relaysFor, useRelayList } from '../state/relays';
import { useRfq } from '../state/rfq';
import { engineFor, useTradeRuntime } from '../state/trade-runtime';
import { useTray } from '../state/tray';
import { useWalletStore } from '../state/wallet';

export function TradeRuntime() {
  const ports = useData();
  const onTrade = useLocation().pathname === '/trade';
  const phase = useRfq((s) => s.state.phase);
  const [attached, setAttached] = useState<DataPorts>();
  const ready = attached === ports;

  const lists = useRelayList((s) => s.lists);
  const urls = useMemo(() => relaysFor(lists, ports.network.id, ports.network.defaultRelays), [lists, ports]);
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  useEffect(() => {
    useRfq.getState().attach(ports.storage.session, ports.network.pairs[0]?.code ?? '');
    setAttached(ports);
  }, [ports]);

  const engine = useTradeRuntime((s) => (s.ports === ports ? s.engine : undefined));
  const active = ready && (onTrade || phase === 'sealed' || phase === 'revealed' || phase === 'settling');

  useEffect(() => {
    if (!active || engine) return;
    let stale = false;
    void import('../features/trade/engine').then(({ TradeEngine }) => {
      if (stale || engineFor(ports)) return;
      useTradeRuntime.setState({ engine: new TradeEngine(ports, () => urlsRef.current), ports });
    });
    return () => {
      stale = true;
    };
  }, [active, engine, ports]);

  // After a reload mid-trade: reconnect relays and restart any scripted counterparties (tests). The
  // engine lives as long as its ports.
  useEffect(() => {
    if (!engine) return;
    const s = useRfq.getState().state;
    if ((s.phase === 'sealed' || s.phase === 'revealed') && !ports.relays.status().some((r) => r.connected)) {
      void ports.relays.connect(urlsRef.current).catch(() => undefined);
    }
    engine.resumeScenario();
    return () => {
      engine.dispose();
      if (useTradeRuntime.getState().engine === engine) useTradeRuntime.setState({ engine: undefined, ports: undefined });
    };
  }, [engine, ports]);

  useEffect(() => {
    if (!engine) return;
    void engine.tick();
    const id = setInterval(() => void engine.tick(), ports.pollMs ?? 2000);
    return () => clearInterval(id);
  }, [engine, ports]);

  // Socket status straight from the port: useRelays would start a second /health poll.
  const [relaysConnected, setRelaysConnected] = useState(0);
  useEffect(() => {
    const count = (states: RelayState[]) => setRelaysConnected(states.filter((r) => r.connected).length);
    count(ports.relays.status());
    return ports.relays.onStatus(count);
  }, [ports]);

  const walletLost = useWalletStore((s) => s.status === 'lost');
  const tray = useTray((s) => s.entries);
  const show = useOverlays((s) => s.show);

  useEffect(() => {
    if (!ready) return;
    const provenQuotes = new Set(tray.filter((e) => e.kind === 'fraud-proof' && e.status === 'done' && e.ref).map((e) => e.ref!));
    const run = () => {
      const state = useRfq.getState().state;
      const nowMs = ports.clock.nowMs();
      const pair = ports.network.pairs.find((p) => p.code === state.rfq?.pair);
      const drafts = tradeNotices(state, { now: Math.floor(nowMs / 1000), onTrade, pair, relaysConnected, walletLost, provenQuotes });
      const appeared = useNotifications.getState().sync(TRADE_NOTICE_PREFIX, drafts, nowMs);
      if (onTrade) return;
      for (const n of appeared) {
        if (!n.toast) continue;
        toast({ tone: n.tone, title: n.title, body: n.body, action: { label: 'Open notifications', onClick: () => show('notifications') } }, n.kind === 'action' ? 8000 : 5000);
      }
    };
    run();
    const unsubscribe = useRfq.subscribe(run);
    const id = setInterval(run, 1000);
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, [ready, ports, onTrade, relaysConnected, walletLost, tray, show]);

  return null;
}
