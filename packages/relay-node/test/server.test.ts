// End-to-end over real sockets: HTTP endpoints, and two real relay-node servers gossiping over an
// actual WebSocket connection (not the in-process fakes gossip.test.ts uses).

import { describe, expect, it, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { startRelayServer, type RelayServer } from '../src/server.js';
import { makeRfqEnvelope, hexOf } from './helpers.js';

function portOf(server: RelayServer): number {
  const addr = server.http.address();
  if (addr === null || typeof addr === 'string') throw new Error('server not listening on a port');
  return addr.port;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const servers: RelayServer[] = [];
function track(s: RelayServer): RelayServer {
  servers.push(s);
  return s;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('HTTP endpoints', () => {
  it('/health reports ok, peer count, version, uptime', async () => {
    const server = track(startRelayServer({ port: 0 }));
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/health`);
    const body = (await res.json()) as { ok: boolean; peers: number; version: number; uptimeSec: number };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.peers).toBe(0);
    expect(typeof body.version).toBe('number');
    expect(typeof body.uptimeSec).toBe('number');
  });

  it('/rfqs returns rfqs published over the gossip socket', async () => {
    const server = track(startRelayServer({ port: 0 }));
    const port = portOf(server);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/gossip`);
    await new Promise((resolve) => ws.on('open', resolve));

    const env = makeRfqEnvelope({ pair: 'tNIGHT/USDM' });
    ws.send(JSON.stringify(env));
    await waitFor(() => server.gossip.getRfqs().length === 1);

    const res = await fetch(`http://127.0.0.1:${port}/rfqs?pair=tNIGHT/USDM`);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(env.id);

    ws.close();
  });

  it('mailbox POST then GET round-trips an opaque entry, and clears it on pickup', async () => {
    const server = track(startRelayServer({ port: 0, enableMailbox: true }));
    const port = portOf(server);
    const to = hexOf(0x42);
    const payload = JSON.stringify({
      v: 1,
      type: 'reveal',
      quoteId: hexOf(0x11),
      ciphertext: Buffer.from('opaque').toString('base64'),
      sig: 'aa'.repeat(96),
    });

    const put = await fetch(`http://127.0.0.1:${port}/mailbox/${to}`, { method: 'POST', body: payload });
    expect(put.status).toBe(202);

    const get1 = await fetch(`http://127.0.0.1:${port}/mailbox/${to}`);
    const entries1 = await get1.json();
    expect(entries1).toHaveLength(1);

    const get2 = await fetch(`http://127.0.0.1:${port}/mailbox/${to}`);
    const entries2 = await get2.json();
    expect(entries2).toHaveLength(0);
  });

  it('allows cross-origin reads on every HTTP endpoint and answers preflight with 204', async () => {
    const server = track(startRelayServer({ port: 0, enableMailbox: true }));
    const base = `http://127.0.0.1:${portOf(server)}`;
    const origin = { origin: 'http://localhost:5173' };

    for (const path of ['/health', '/rfqs', `/mailbox/${hexOf(0x42)}`]) {
      const get = await fetch(`${base}${path}`, { headers: origin });
      expect(get.status).toBe(200);
      expect(get.headers.get('access-control-allow-origin')).toBe('*');

      const preflight = await fetch(`${base}${path}`, {
        method: 'OPTIONS',
        headers: { ...origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
      expect(preflight.headers.get('access-control-allow-methods')).toContain('GET');
      expect(preflight.headers.get('access-control-allow-methods')).toContain('OPTIONS');
      expect(preflight.headers.get('access-control-allow-headers')).toContain('content-type');
    }

    // Error responses carry the header too, or a browser reports a CORS failure instead of the error.
    const bad = await fetch(`${base}/mailbox/not-hex`, { headers: origin });
    expect(bad.status).toBe(400);
    expect(bad.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('mailbox routes 404 when RELAY_ENABLE_MAILBOX is off', async () => {
    const server = track(startRelayServer({ port: 0, enableMailbox: false }));
    const port = portOf(server);
    const res = await fetch(`http://127.0.0.1:${port}/mailbox/${hexOf(0x42)}`);
    expect(res.status).toBe(404);
  });
});

describe('two real relay-node servers gossiping over WebSocket', () => {
  it('a message published to node A reaches node B over the wire', async () => {
    const nodeB = track(startRelayServer({ port: 0 }));
    const portB = portOf(nodeB);
    const nodeA = track(
      startRelayServer({ port: 0, peers: [`ws://127.0.0.1:${portB}/gossip`], reconnectDelayMs: 100 }),
    );
    const portA = portOf(nodeA);

    await waitFor(() => nodeB.gossip.peerCount >= 1);

    const client = new WebSocket(`ws://127.0.0.1:${portA}/gossip`);
    await new Promise((resolve) => client.on('open', resolve));

    const env = makeRfqEnvelope({ pair: 'tNIGHT/USDM' });
    client.send(JSON.stringify(env));

    await waitFor(() => nodeB.gossip.getRfqs().length === 1);
    expect(nodeB.gossip.getRfqs()[0].id).toBe(env.id);

    client.close();
  }, 10_000);
});
