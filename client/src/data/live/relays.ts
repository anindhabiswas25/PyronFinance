// RelayPort over real relays: the SDK's RelayAggregator (loaded when a page first connects, so public
// pages never pull it in) with the browser's WebSocket, plus per-socket status, /health checks, and
// the incoming-RFQ view a dealer desk needs.

import type { AggregationResult, RelayAggregator, RevealMessage, RfqBody, WebSocketLike } from '@otc/sdk/browser';
import type { ChainPort, IncomingRfq, RelayHealth, RelayPort, RelayState, SyncStore } from '../ports';
import { RelayCountError } from '../../lib/errors';
import { MIN_RELAYS, fetchRelayHealth, isRevealMessage, mailboxUrl, persistReveals } from '../relay-util';

function looksLikeRfq(body: unknown): body is RfqBody {
  const b = body as RfqBody;
  return (
    Boolean(b) &&
    typeof b.rfqId === 'string' &&
    typeof b.pair === 'string' &&
    (b.side === 'buy' || b.side === 'sell') &&
    typeof b.size === 'string' &&
    typeof b.expiry === 'number' &&
    typeof b.takerEncPk === 'string' &&
    Array.isArray(b.replyTo)
  );
}

export function createLiveRelays(o: { chain: ChainPort; session: SyncStore; socket?: (url: string) => WebSocket }): RelayPort {
  const openSocket = o.socket ?? ((url: string) => new WebSocket(url));
  let aggregator: RelayAggregator | undefined;
  let urls: string[] = [];
  const connected = new Set<string>();
  const health = new Map<string, RelayHealth>();
  const listeners = new Set<(s: RelayState[]) => void>();
  const rfqs = new Map<string, IncomingRfq>();

  const status = (): RelayState[] => urls.map((url) => ({ url, connected: connected.has(url), health: health.get(url) }));
  const emit = () => {
    const s = status();
    for (const l of listeners) l(s);
  };

  const noteFrame = (url: string, data: unknown) => {
    try {
      const env = JSON.parse(String(data)) as { type?: string; id?: string; body?: unknown };
      if (env.type !== 'rfq' || typeof env.id !== 'string' || !looksLikeRfq(env.body)) return;
      const existing = rfqs.get(env.id);
      if (existing) {
        if (!existing.relays.includes(url)) existing.relays.push(url);
      } else {
        rfqs.set(env.id, { envelopeId: env.id, body: env.body, receivedAt: Date.now(), relays: [url] });
      }
    } catch {
      // Not JSON: a conforming relay never sends this; ignore.
    }
  };

  const socketFactory = (url: string): WebSocketLike => {
    const ws = openSocket(url);
    ws.addEventListener('open', () => {
      connected.add(url);
      emit();
    });
    const down = () => {
      connected.delete(url);
      emit();
    };
    ws.addEventListener('close', down);
    ws.addEventListener('error', down);
    ws.addEventListener('message', (ev) => noteFrame(url, (ev as MessageEvent).data));
    return ws as unknown as WebSocketLike;
  };

  async function checkHealth(url: string): Promise<RelayHealth> {
    const h = await fetchRelayHealth(url);
    health.set(url, h);
    emit();
    return h;
  }

  return {
    async connect(next) {
      await aggregator?.close();
      aggregator = undefined;
      connected.clear();
      urls = [...next];
      emit();
      const sdk = await import('@otc/sdk/browser');
      aggregator = new sdk.RelayAggregator({ relays: urls, chain: o.chain.chainReader(), socketFactory });
      await aggregator.connect();
      for (const u of urls) void checkHealth(u);
      emit();
      return status();
    },
    status,
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    health: checkHealth,
    publishRfq(body) {
      if (!aggregator || connected.size < MIN_RELAYS) throw new RelayCountError(connected.size, MIN_RELAYS);
      aggregator.publishRfq(body);
    },
    async collect(rfq): Promise<AggregationResult> {
      if (!aggregator) throw new Error('Relays are not connected. Open the relay list and reconnect.');
      return aggregator.collect(rfq);
    },
    async fetchMailbox(base, takerEncPk): Promise<RevealMessage[]> {
      const res = await fetch(mailboxUrl(base, takerEncPk));
      if (!res.ok) throw new Error(`The dealer’s mailbox relay answered HTTP ${res.status}`);
      const body: unknown = await res.json();
      const messages = Array.isArray(body) ? body.filter(isRevealMessage) : [];
      persistReveals(o.session, takerEncPk, base, messages);
      return messages;
    },
    incomingRfqs() {
      const now = Date.now() / 1000;
      for (const [k, v] of rfqs) if (v.body.expiry < now) rfqs.delete(k);
      return [...rfqs.values()];
    },
    async close() {
      await aggregator?.close();
      aggregator = undefined;
      connected.clear();
      emit();
    },
  };
}
