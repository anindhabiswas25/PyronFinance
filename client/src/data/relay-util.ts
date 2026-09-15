// Relay helpers shared by the live and fixture adapters. No SDK imports.

import type { RevealMessage } from '@otc/sdk/browser';
import type { RelayHealth, SyncStore } from './ports';

export const MIN_RELAYS = 2;

/** ws://host:port/gossip → http://host:port (RELAY.md §1: HTTP endpoints share the host). */
export function httpBaseOf(url: string): string {
  const u = new URL(url);
  if (u.protocol === 'ws:') u.protocol = 'http:';
  if (u.protocol === 'wss:') u.protocol = 'https:';
  u.pathname = u.pathname.replace(/\/gossip\/?$/, '');
  u.search = '';
  u.hash = '';
  return u.toString().replace(/\/$/, '');
}

/** Why a typed relay URL can't be used, or undefined when it can. */
export function relayUrlProblem(input: string, existing: readonly string[] = []): string | undefined {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return 'Enter a full address, like wss://relay.example/gossip.';
  }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return 'Relays speak WebSocket: the address starts with wss:// (or ws:// for a local relay).';
  if (!/\/gossip\/?$/.test(u.pathname)) return 'The gossip endpoint ends in /gossip.';
  if (existing.includes(u.toString())) return 'That relay is already in the list.';
  return undefined;
}

export function normalizeRelayUrl(input: string): string {
  return new URL(input.trim()).toString();
}

export async function fetchRelayHealth(url: string, timeoutMs = 5000, fetchImpl: typeof fetch = fetch): Promise<RelayHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const res = await fetchImpl(`${httpBaseOf(url)}/health`, { signal: controller.signal });
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    if (!res.ok) return { ok: false, latencyMs, checkedAt: Date.now(), error: `Answered HTTP ${res.status}` };
    const body = (await res.json()) as { ok?: unknown; peers?: unknown; version?: unknown };
    return {
      ok: body.ok === true,
      peers: typeof body.peers === 'number' ? body.peers : undefined,
      version: body.version === undefined ? undefined : String(body.version),
      latencyMs,
      checkedAt: Date.now(),
      error: body.ok === true ? undefined : 'Reports itself unhealthy',
    };
  } catch {
    return { ok: false, checkedAt: Date.now(), error: controller.signal.aborted ? `No answer within ${timeoutMs / 1000} s` : 'Unreachable (down, or blocks cross-origin requests)' };
  } finally {
    clearTimeout(timer);
  }
}

export function isRevealMessage(v: unknown): v is RevealMessage {
  const m = v as RevealMessage;
  return Boolean(m) && m.type === 'reveal' && typeof m.quoteId === 'string' && typeof m.ciphertext === 'string' && typeof m.sig === 'string';
}

export interface StoredReveal {
  fetchedAt: number;
  base: string;
  msg: RevealMessage;
}

export const revealsKey = (takerEncPk: string) => `reveals:${takerEncPk}`;

/** Appends mailbox messages to session storage. Called BEFORE anything decrypts or renders them: the
 *  relay deleted them on read, so this copy is the only one. Duplicates collapse. */
export function persistReveals(store: SyncStore, takerEncPk: string, base: string, messages: readonly RevealMessage[], now = Date.now()): StoredReveal[] {
  const key = revealsKey(takerEncPk);
  const stored = store.get<StoredReveal[]>(key) ?? [];
  const seen = new Set(stored.map((s) => `${s.msg.quoteId}:${s.msg.ciphertext}`));
  for (const msg of messages) {
    const id = `${msg.quoteId}:${msg.ciphertext}`;
    if (seen.has(id)) continue;
    seen.add(id);
    stored.push({ fetchedAt: now, base, msg });
  }
  store.set(key, stored);
  return stored;
}

export function mailboxUrl(base: string, takerEncPk: string): string {
  const http = /^wss?:/.test(base) ? httpBaseOf(base) : base.replace(/\/$/, '');
  return `${http}/mailbox/${takerEncPk}`;
}
