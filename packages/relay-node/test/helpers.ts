import {
  computeId,
  signBody,
  encodeSignature,
  WIRE_VERSION,
  type Envelope,
  type RfqBody,
  type QuoteRefBody,
  type CancelBody,
} from '../src/schema.js';
import { freshNonce } from '../../sdk/src/schnorr.js';

export const DEALER_SK = 12345678901234567890n % 6554484396890773809930967563523245729705921265872317281365359162392183254199n;

export function hexOf(byte: number, len = 32): string {
  return byte.toString(16).padStart(2, '0').repeat(len);
}

export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

export function makeRfqBody(overrides: Partial<RfqBody> = {}): RfqBody {
  return {
    rfqId: hexOf(0xaa),
    pair: 'tNIGHT/USDM',
    side: 'buy',
    size: '1000.0',
    expiry: nowSecs() + 300,
    takerEncPk: hexOf(0xbb),
    replyTo: ['wss://relay-a.example/gossip'],
    ...overrides,
  };
}

export function makeRfqEnvelope(
  overrides: Partial<RfqBody> = {},
  envOverrides: Partial<Omit<Envelope, 'body' | 'type'>> = {},
): Envelope<RfqBody> {
  const body = makeRfqBody(overrides);
  const id = computeId(body);
  return { v: WIRE_VERSION, type: 'rfq', id, ts: nowSecs(), ttl: 8, body, ...envOverrides };
}

export function makeQuoteRefBody(overrides: Partial<QuoteRefBody> = {}): QuoteRefBody {
  return {
    rfqId: hexOf(0xaa),
    dealerCmt: hexOf(0xcc),
    quoteId: hexOf(0xdd),
    validUntil: nowSecs() + 900,
    txHash: hexOf(0xee),
    revealVia: 'direct',
    dealerEndpoint: 'wss://dealer-a.example/reveal',
    dealerEncPk: hexOf(0xff),
    ...overrides,
  };
}

export function makeSignedQuoteRefEnvelope(
  overrides: Partial<QuoteRefBody> = {},
  envOverrides: Partial<Omit<Envelope, 'body' | 'type'>> = {},
  sk: bigint = DEALER_SK,
): Envelope<QuoteRefBody> {
  const body = makeQuoteRefBody(overrides);
  const id = computeId(body);
  const sig = encodeSignature(signBody(body, sk, freshNonce()));
  return { v: WIRE_VERSION, type: 'quote_ref', id, ts: nowSecs(), ttl: 8, body, sig, ...envOverrides };
}

export function makeCancelBody(overrides: Partial<CancelBody> = {}): CancelBody {
  return { quoteId: hexOf(0xdd), dealerCmt: hexOf(0xcc), ...overrides };
}

export function makeSignedCancelEnvelope(
  overrides: Partial<CancelBody> = {},
  envOverrides: Partial<Omit<Envelope, 'body' | 'type'>> = {},
  sk: bigint = DEALER_SK,
): Envelope<CancelBody> {
  const body = makeCancelBody(overrides);
  const id = computeId(body);
  const sig = encodeSignature(signBody(body, sk, freshNonce()));
  return { v: WIRE_VERSION, type: 'cancel', id, ts: nowSecs(), ttl: 8, body, sig, ...envOverrides };
}
