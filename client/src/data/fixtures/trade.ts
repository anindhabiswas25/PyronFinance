// The /trade sample scenario, clock-driven and deterministic. It runs the real protocol checks: every
// quote is sealed with sealQuote, committed to the sample chain, announced with a quote_ref signed by
// the dealer's quote key (so verifyQuoteRef really verifies it), revealed with buildReveal and
// encryptReveal, and backed by a real (mock-proved) Offer File. Only the chain, relays and wallet are
// simulated.
//
// Timeline, in scenario seconds from publishing: dealer A's seal confirms at +22, B's at +45, and a
// third dealer's at +47; each reveal lands 2 s later. The third dealer reveals a price that doesn't
// open its seal. B's quote is valid for only 95 s, so it expires while the taker compares.
//
// ?scenario=
//   happy          settles
//   inputs-spent   the best quote's offer coins are spent before settling
//   wallet-shape   the wallet's side spends 8 coins and fails the time-to-dismiss rule
//   rejected       the node rejects the submission
//   no-quotes      no dealer answers
//   indexer-down   the chain can't be read (chain adapter)
//   one-relay      only one relay connects, so the request is refused (relay adapter)

import * as sdk from '@otc/sdk/browser';
import type { AggregationResult, Envelope, QuoteRefBody, RevealMessage, RfqBody } from '@otc/sdk/browser';
import { tokenTypeOf } from '../../config/networks';
import { httpBaseOf } from '../relay-util';
import { oppositeSide } from '../../lib/side';
import type { FixturePorts } from './index';
import { SCENARIO_TIMELINE, type ScenarioName } from './scenario';
import type { ScenarioRole } from './dataset';

const PRICES: Record<'a' | 'b' | 'fraud', { committed: string; revealed: string }> = {
  a: { committed: '41.440000', revealed: '41.440000' },
  b: { committed: '41.520000', revealed: '41.520000' },
  fraud: { committed: '41.300000', revealed: '41.900000' },
};

/** Deterministic sample keys per role. Throwaway: they exist only in this sample scenario. */
function roleSecret(role: string, rfqId: string, salt: number): Uint8Array {
  const out = new Uint8Array(32);
  const seed = `${role}:${salt}:${rfqId}`;
  for (let i = 0; i < seed.length; i++) out[i % 32] = (out[i % 32] * 31 + seed.charCodeAt(i)) & 0xff;
  out[0] |= 1;
  return out;
}

function quoteSecretKey(role: string, rfqId: string): bigint {
  const b = roleSecret(role, rfqId, 7);
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return (v % (sdk.JUBJUB_R - 2n)) + 1n;
}

interface Pending {
  role: 'a' | 'b' | 'fraud';
  envelope: Envelope<QuoteRefBody>;
  relays: string[];
}

export function startFixtureTrade(ports: FixturePorts, rfq: RfqBody, options: { resume?: boolean } = {}): () => void {
  const scenario: ScenarioName = ports.scenario;
  const speed = Math.max(1, ports.speed);
  const clockSecs = () => Math.floor(ports.clock.nowMs() / 1000);
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const later = (scenarioSecs: number, fn: () => void) => timers.push(setTimeout(fn, Math.max(0, (scenarioSecs * 1000) / speed)));

  const pair = ports.network.pairs.find((p) => p.code === rfq.pair) ?? ports.network.pairs[0];
  const base = tokenTypeOf(pair.base);
  const counter = tokenTypeOf(pair.counter);
  const relayUrls = rfq.replyTo;
  const heardOn = scenario === 'one-relay' ? relayUrls.slice(0, 1) : relayUrls;
  const mailboxBase = relayUrls[0] ? httpBaseOf(relayUrls[0]) : 'http://sample-relay';

  const pending: Pending[] = [];
  const mailbox: RevealMessage[] = [];
  /** quoteId → the inputs its Offer File spends, to find which quote a settlement settled. */
  const offerInputs = new Map<string, string[]>();
  const rfqIdBytes = sdk.hexToBytes(rfq.rfqId);
  const size = rfq.size;

  ports.relays.setCollector(async (asked): Promise<AggregationResult> => {
    const verified: AggregationResult['verified'] = [];
    const rejected: AggregationResult['rejected'] = [];
    const reader = ports.chain.chainReader();
    for (const p of pending) {
      // A failing chain read throws out of collect — "couldn't verify", never "rejected".
      const verdict = await sdk.verifyQuoteRef(p.envelope, asked, reader, clockSecs());
      if (verdict.ok) verified.push({ ...verdict.quote, relays: p.relays });
      else rejected.push({ envelopeId: p.envelope.id, quoteId: p.envelope.body.quoteId, relays: p.relays, reason: verdict.reason });
    }
    return { relaysConnected: heardOn.length, relaysTotal: relayUrls.length, verified, rejected };
  });

  ports.relays.setMailbox((_base, takerEncPk) => {
    if (takerEncPk !== rfq.takerEncPk) return [];
    return mailbox.splice(0); // a relay mailbox deletes on read
  });

  ports.wallet.setHandlers({
    async balanceSealed(txHex) {
      await new Promise((r) => setTimeout(r, 1200 / speed));
      const offerFile = sdk.bytesToBase64(sdk.hexToBytes(txHex));
      const takerSells = rfq.side === 'sell';
      // Read the dealer half's own vector to build the matching taker side.
      const vector = sdk.tradeableBalance(sdk.balanceVectorOf(sdk.deserializeOffer(offerFile)));
      const baseAmt = vector[`unshielded:${base}`] ?? 0n;
      const counterAmt = vector[`unshielded:${counter}`] ?? 0n;
      const abs = (v: bigint) => (v < 0n ? -v : v);
      const takerGives = takerSells ? { token: base, amount: abs(baseAmt) } : { token: counter, amount: abs(counterAmt) };
      const takerWants = takerSells ? { token: counter, amount: abs(counterAmt) } : { token: base, amount: abs(baseAmt) };
      const settlement = sdk.buildSampleSettlement({
        networkId: ports.network.walletNetworkId,
        offerFile,
        takerGives,
        takerWants,
        inputs: scenario === 'wallet-shape' ? 8 : 1,
      });
      return settlement.txHex;
    },
    async submit(txHex) {
      await new Promise((r) => setTimeout(r, (SCENARIO_TIMELINE.settleSecs * 1000) / speed));
      if (scenario === 'rejected') throw new Error('1010: Invalid Transaction: Custom error: 138');
      const merged = sdk.deserializeOffer(sdk.bytesToBase64(sdk.hexToBytes(txHex)));
      const identifiers = merged.identifiers().map(String);
      const hash = String(merged.transactionHash());
      ports.chain.registerTransaction({ hash, identifiers });
      // The dealer records the settlement on its own loop, a little later.
      const settledInputs = sdk.inputsOf(merged);
      const quoteId = [...offerInputs].find(([, inputs]) => inputs.some((i) => settledInputs.includes(i)))?.[0];
      if (quoteId) {
        later(15, () => {
          const q = ports.chain.dataset.ledger.quotes.get(quoteId);
          if (q && !q.resolved) ports.chain.append([{ kind: 'quote-settled', dealerCmt: q.dealerCmt, quoteId, notional: q.notional }]);
        });
      }
    },
  });

  if (!options.resume && scenario !== 'no-quotes') {
    const dealers = ports.chain.dataset.dealers;
    for (const commit of SCENARIO_TIMELINE.commits) {
      const role = commit.role as Exclude<ScenarioRole, 'c'>;
      const dealer = dealers.find((d) => d.role === role);
      if (!dealer) continue;
      later(commit.confirmAfterSecs, () => {
        const bond = ports.chain.dataset.ledger.bonds.get(dealer.dealerCmt);
        const quoteSk = quoteSecretKey(role, rfq.rfqId);
        ports.chain.setQuoteKey(dealer.dealerCmt, sdk.schnorrPublicKey(quoteSk));
        const committedTerms = { pair: rfq.pair, side: oppositeSide(rfq.side), price: PRICES[role].committed, size };
        const validUntil = BigInt(clockSecs() + commit.validitySecs);
        let sealed: ReturnType<typeof sdk.sealQuote>;
        try {
          sealed = sdk.sealQuote(committedTerms, rfqIdBytes, validUntil);
        } catch {
          return; // a size this pair can't encode: the dealer ignores the request
        }
        if (!bond?.active || sealed.notional > bond.amount * 20n) return; // over this dealer's cap: no quote
        const quoteId = sdk.bytesToHex(sdk.deriveQuoteId(sdk.hexToBytes(dealer.dealerCmt), rfqIdBytes, sealed.commitment));
        const [event] = ports.chain.append([
          { kind: 'quote-sealed', dealerCmt: dealer.dealerCmt, quoteId, rfqId: rfq.rfqId, commitment: sdk.bytesToHex(sealed.commitment), notional: sealed.notional, validUntil },
        ]);
        const revealKeys = sdk.encKeypairFromSecret(roleSecret(role, rfq.rfqId, 11));
        const body: QuoteRefBody = {
          rfqId: rfq.rfqId,
          dealerCmt: dealer.dealerCmt,
          quoteId,
          validUntil: Number(validUntil),
          txHash: event.txHash,
          revealVia: 'mailbox',
          dealerEndpoint: mailboxBase,
          dealerEncPk: sdk.bytesToHex(revealKeys.pk),
        };
        const envelope: Envelope<QuoteRefBody> = {
          v: sdk.WIRE_VERSION,
          type: 'quote_ref',
          id: sdk.computeId(body),
          ts: clockSecs(),
          ttl: 8,
          body,
          sig: sdk.encodeSignature(sdk.signBody(body, quoteSk)),
        };
        pending.push({ role, envelope, relays: heardOn });

        later(SCENARIO_TIMELINE.revealAfterSecs, () => {
          const revealedTerms = { ...committedTerms, price: PRICES[role].revealed };
          const baseAmount = sdk.encodeTerms(revealedTerms)[3];
          const counterAmount = sdk.counterAmountFor(revealedTerms);
          const dealerGivesBase = revealedTerms.side === 'sell';
          const offer = sdk.buildSampleOffer({
            networkId: ports.network.walletNetworkId,
            gives: dealerGivesBase ? { token: base, amount: baseAmount } : { token: counter, amount: counterAmount },
            wants: dealerGivesBase ? { token: counter, amount: counterAmount } : { token: base, amount: baseAmount },
          });
          offerInputs.set(quoteId, offer.inputs);
          if (scenario === 'inputs-spent' && role === 'b') {
            // The best quote's dealer spends the coins behind its offer while the quote is live.
            for (const input of offer.inputs) {
              ports.chain.markInputSpent(input, sdk.bytesToHex(crypto.getRandomValues(new Uint8Array(32))));
            }
          }
          const sealedForReveal = { ...sealed, terms: revealedTerms, encodedTerms: sdk.encodeTerms(revealedTerms) };
          const reveal = sdk.buildReveal(sealedForReveal, quoteSk, offer.offerFile, offer.expiresAt);
          mailbox.push(sdk.encryptReveal(sdk.hexToBytes(quoteId), reveal, revealKeys.sk, sdk.hexToBytes(rfq.takerEncPk)));
        });
      });
    }
  }

  return () => {
    for (const t of timers) clearTimeout(t);
    ports.relays.setCollector(undefined);
    ports.relays.setMailbox(undefined);
    ports.wallet.setHandlers({});
  };
}
