// WebSocket + HTTP endpoints — RELAY.md §1, §7.
//
// `ws://<host>:<port>/gossip` serves both peer-to-peer and client connections identically (the
// spec's own wording: "same endpoint"), since a relay has no way to tell a fellow relay node
// apart from a browser taker except by behavior, and treating them differently would be exactly
// the kind of privileged-peer distinction the protocol's untrusted-relay model forbids.

import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { GossipNode, type PeerHandle } from './gossip.js';
import { Mailbox } from './mailbox.js';
import { WIRE_VERSION, MAX_MSG_BYTES } from './schema.js';
import { isHexOfLength } from './bytes.js';

export interface RelayServerOptions {
  port: number;
  /** Bootstrap peer endpoints (`wss://host/gossip`) to connect outbound to on startup. */
  peers?: string[];
  maxMsgBytes?: number;
  enableMailbox?: boolean;
  /** Pairs this node advertises in its own `peer_announce`. Informational only. */
  pairs?: string[];
  /** Sweep interval for expired rfqs/quote_refs/seen-set/mailbox entries. */
  sweepIntervalMs?: number;
  /** How long to wait before retrying a dropped outbound peer connection. */
  reconnectDelayMs?: number;
}

export interface RelayServer {
  readonly gossip: GossipNode;
  readonly mailbox: Mailbox;
  readonly http: HttpServer;
  readonly wss: WebSocketServer;
  readonly startedAtMs: number;
  close(): Promise<void>;
}

let peerCounter = 0;

/** RELAY.md §1: HTTP endpoints MUST allow cross-origin reads so a browser taker served from any
 *  origin can use them. A wildcard is safe: a relay holds only public gossip and ciphertext it
 *  cannot read, and never uses cookies or credentials. */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
} as const;

function jsonResponse(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS_HEADERS,
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function startRelayServer(options: RelayServerOptions): RelayServer {
  const maxMsgBytes = options.maxMsgBytes ?? MAX_MSG_BYTES;
  const enableMailbox = options.enableMailbox ?? false;
  const sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
  const reconnectDelayMs = options.reconnectDelayMs ?? 5_000;
  const startedAtMs = Date.now();

  const gossip = new GossipNode();
  const mailbox = new Mailbox();

  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // CORS preflight. A browser sends one before a POST with `content-type: application/json`.
    if (
      req.method === 'OPTIONS' &&
      (url.pathname === '/health' || url.pathname === '/rfqs' || (enableMailbox && url.pathname.startsWith('/mailbox/')))
    ) {
      res.writeHead(204, { ...CORS_HEADERS, 'access-control-max-age': '600', 'content-length': 0 });
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      jsonResponse(res, 200, {
        ok: true,
        peers: gossip.peerCount,
        version: WIRE_VERSION,
        uptimeSec: Math.floor((Date.now() - startedAtMs) / 1000),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/rfqs') {
      const pair = url.searchParams.get('pair') ?? undefined;
      const sinceRaw = url.searchParams.get('since');
      const sinceSecs = sinceRaw !== null && sinceRaw !== '' ? Number(sinceRaw) : undefined;
      jsonResponse(res, 200, gossip.getRfqs({ pair, sinceSecs }));
      return;
    }

    if (enableMailbox && url.pathname.startsWith('/mailbox/')) {
      const takerEncPk = url.pathname.slice('/mailbox/'.length);
      if (!isHexOfLength(takerEncPk, 32)) {
        jsonResponse(res, 400, { error: 'recipient must be 32-byte hex' });
        return;
      }
      if (req.method === 'GET') {
        jsonResponse(res, 200, mailbox.take(takerEncPk));
        return;
      }
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        let tooLarge = false;
        req.on('data', (chunk: Buffer) => {
          if (tooLarge) return;
          chunks.push(chunk);
          if (chunks.reduce((n, c) => n + c.length, 0) > maxMsgBytes) {
            tooLarge = true;
            jsonResponse(res, 413, { error: 'entry exceeds MAX_MSG_BYTES' });
            req.destroy();
          }
        });
        req.on('end', () => {
          if (tooLarge) return;
          const raw = Buffer.concat(chunks).toString('utf8');
          const err = mailbox.put(takerEncPk, raw);
          if (err) jsonResponse(res, 400, { error: err });
          else jsonResponse(res, 202, { ok: true });
        });
        return;
      }
    }

    jsonResponse(res, 404, { error: 'not found' });
  });

  const wss = new WebSocketServer({ server: http, path: '/gossip', maxPayload: maxMsgBytes });

  function registerSocket(ws: WebSocket, peerId: string): void {
    const handle: PeerHandle = { id: peerId, send: (raw) => ws.readyState === WebSocket.OPEN && ws.send(raw) };
    gossip.addPeer(handle);
    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      gossip.handleMessage(peerId, raw);
    });
    ws.on('close', () => gossip.removePeer(peerId));
    ws.on('error', () => gossip.removePeer(peerId));
  }

  wss.on('connection', (ws, req) => {
    const peerId = `${req.socket.remoteAddress ?? 'unknown'}:${req.socket.remotePort ?? 0}:${peerCounter++}`;
    if (gossip.peerTable.isBanned(peerId)) {
      ws.close(1008, 'banned');
      return;
    }
    registerSocket(ws, peerId);
  });

  const outboundSockets: WebSocket[] = [];
  let closing = false;
  for (const endpoint of options.peers ?? []) {
    connectOutbound(endpoint);
  }

  function connectOutbound(endpoint: string): void {
    if (closing) return;
    const ws = new WebSocket(endpoint);
    const peerId = `outbound:${endpoint}`;
    outboundSockets.push(ws);
    ws.on('open', () => registerSocket(ws, peerId));
    const retry = () => {
      gossip.removePeer(peerId);
      if (!closing) setTimeout(() => connectOutbound(endpoint), reconnectDelayMs);
    };
    ws.on('close', retry);
    ws.on('error', retry);
  }

  const sweepTimer = setInterval(() => {
    gossip.sweepExpired();
    if (enableMailbox) mailbox.sweepExpired();
  }, sweepIntervalMs);
  sweepTimer.unref?.();

  http.listen(options.port);

  return {
    gossip,
    mailbox,
    http,
    wss,
    startedAtMs,
    close(): Promise<void> {
      closing = true;
      clearInterval(sweepTimer);
      for (const ws of outboundSockets) ws.terminate();
      return new Promise((resolve, reject) => {
        wss.close(() => {
          http.close((err) => (err ? reject(err) : resolve()));
        });
        for (const client of wss.clients) client.terminate();
      });
    },
  };
}
