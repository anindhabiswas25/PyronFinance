// Parses what a user pastes or loads on /verify. Accepts the files this app writes (failure evidence,
// sealed notes) and the bare shapes, and says what is missing instead of guessing.

import type { FraudReveal } from '../state/overlays';
import { isHex32, normalizeHex } from './hex';

export interface RevealInput {
  kind: 'evidence' | 'reveal';
  quoteId: string;
  reveal: FraudReveal;
  /** `intentHash:outputIndex` of each coin the Offer File spends (failure evidence only). */
  offerInputs: string[];
  /** Base64 Offer File (failure evidence): lets the checks find each coin's owner and look it up. */
  offerFile?: string;
  failure?: { reason: string; detail: string; spentBy?: string };
}

export interface NoteBlob {
  v: 1;
  epk: string;
  nonce: string;
  ct: string;
}

export interface NoteInput {
  blob: NoteBlob;
  /** Present when the file names it (notes saved by this app do). */
  tradeId?: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseJson(text: string): Parsed<Record<string, unknown>> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Paste JSON or load a file.' };
  try {
    const v = JSON.parse(trimmed) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Expected a JSON object.' };
    return { ok: true, value: v as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'That isn’t valid JSON.' };
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function parseRevealInput(text: string): Parsed<RevealInput> {
  const json = parseJson(text);
  if (!json.ok) return json;
  const o = json.value;
  const kind = o.kind === 'pyron-failure-evidence' ? 'evidence' : 'reveal';
  const quoteId = normalizeHex(str(o.quoteId) ?? '');
  const dealerCmt = normalizeHex(str(o.dealerCmt) ?? '');
  const nonce = normalizeHex(str(o.nonce) ?? '');
  const message = o.revealMessage as { sig?: unknown } | undefined;
  const signature = normalizeHex(str(o.signature) ?? str(message?.sig) ?? '');
  const t = o.terms as Record<string, unknown> | undefined;

  const missing: string[] = [];
  if (!isHex32(quoteId)) missing.push('quoteId (64 hex)');
  if (!isHex32(dealerCmt)) missing.push('dealerCmt (64 hex)');
  if (!isHex32(nonce)) missing.push('nonce (64 hex)');
  if (!/^[0-9a-f]{192}$/.test(signature)) missing.push('signature (192 hex)');
  const side = t?.side;
  if (!t || typeof t.pair !== 'string' || (side !== 'buy' && side !== 'sell') || typeof t.price !== 'string' || typeof t.size !== 'string') {
    missing.push('terms { pair, side, price, size }');
  }
  if (missing.length) return { ok: false, error: `Missing or malformed: ${missing.join(', ')}.` };

  const f = o.failure as Record<string, unknown> | undefined;
  return {
    ok: true,
    value: {
      kind,
      quoteId,
      reveal: {
        dealerCmt,
        nonce,
        signature,
        terms: { pair: t!.pair as string, side: side as 'buy' | 'sell', price: t!.price as string, size: t!.size as string },
      },
      offerInputs: Array.isArray(o.offerInputs) ? o.offerInputs.filter((x): x is string => typeof x === 'string') : [],
      offerFile: str(o.offerFile),
      failure: f && typeof f.reason === 'string' ? { reason: f.reason, detail: str(f.detail) ?? '', spentBy: str(f.spentBy) } : undefined,
    },
  };
}

function isBlob(v: unknown): v is NoteBlob {
  const b = v as Record<string, unknown> | undefined;
  return Boolean(b) && b!.v === 1 && typeof b!.epk === 'string' && typeof b!.nonce === 'string' && typeof b!.ct === 'string';
}

export function parseNoteInput(text: string): Parsed<NoteInput> {
  const json = parseJson(text);
  if (!json.ok) return json;
  const o = json.value;
  const blob = isBlob(o.blob) ? o.blob : isBlob(o) ? o : undefined;
  if (!blob) return { ok: false, error: 'This isn’t a disclosure note: expected { v: 1, epk, nonce, ct }, or a note file saved by this app.' };
  const tradeId = normalizeHex(str(o.tradeId) ?? '');
  return { ok: true, value: { blob, tradeId: isHex32(tradeId) ? tradeId : undefined } };
}
