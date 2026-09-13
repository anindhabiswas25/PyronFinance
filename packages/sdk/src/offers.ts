// Zswap Offer File construction, proving, serialization and settlement.
//
// We reuse Zswap's audited atomic-swap primitive rather than reimplementing settlement
// (docs/CONTRACTS.md §1 non-goals; docs/ARCHITECTURE.md's on-chain/off-chain split table). There is
// no matching engine here and there cannot be one: matching is `balance vectors sum to zero`, which
// is arithmetic, not search (zswap-offer-files SKILL.md §2).
//
// ============================================================================================
// WHY THE WALLET IS REQUIRED (this module's signature changed because of it)
// ============================================================================================
// ledger-v8's `ZswapInput` exposes only `newContractOwned`. There is NO public constructor for a
// user-owned input, so a user's half-swap cannot be built from raw Zswap primitives at all. The
// wallet must build it: it holds the secret keys and does coin selection. The earlier stub's
// `proofServerUrl` parameter was therefore the wrong shape — proving is reached through the
// facade's configured proving service, not by talking to :6300 directly.
//
// ============================================================================================
// VERIFIED SEMANTICS OF `WalletFacade.initSwap` (scripts/probe-swap-semantics.ts, Preprod)
// ============================================================================================
// Determined empirically against a real synced wallet doing real coin selection, NOT read off the
// types — the parameter is named `desiredInputs`, which reads either way, and guessing produces an
// offer that looks correct and fails at settlement.
//
//   desiredInputs : Record<RawTokenType, bigint>   → tokens this wallet SPENDS.
//       The balancer selects the wallet's own UTXOs until the segment imbalance reaches this
//       amount, then writes the remainder back as change to self. Contributes a POSITIVE delta.
//   desiredOutputs: TokenTransfer[]                → coins CREATED, unfunded by this half.
//       For a swap half, `receiverAddress` is YOUR OWN address: this is what you want to RECEIVE,
//       and the counterparty's surplus funds it. Contributes a NEGATIVE delta.
//
// Measured (probe output, native NIGHT):
//     desiredInputs {NIGHT: 1000}, desiredOutputs [{NIGHT: 700 → self}]  →  delta +300
//     desiredInputs {NIGHT: 1000}, desiredOutputs []                     →  delta +1000
//     desiredInputs {},            desiredOutputs [{NIGHT: 700 → self}]  →  delta -700
//
// So a dealer selling 1000 tNIGHT for 41440 USDM builds
//     desiredInputs { tNIGHT: 1000n }, desiredOutputs [{ USDM: 41440n → self }]
// yielding { tNIGHT: +1000, USDM: -41440 } — exactly zswap-offer-files SKILL.md §2's example.
//
// Two further behaviours worth knowing, both found the hard way:
//
//   * `desiredInputs.unshielded` must be PRESENT even when empty. The facade builds an unshielded
//     leg only when `desiredInputs.unshielded !== undefined`; omit the key while supplying
//     unshielded outputs and the leg is dropped, and the call dies with the unhelpful
//     "Unexpected transaction state." Pass `{}`.
//   * Balance-vector keys are TAGGED OBJECTS — `{tag:'unshielded', raw}`, `{tag:'shielded', raw}`,
//     `{tag:'dust'}` — not `RawTokenType` strings (`ZswapOffer.deltas` is keyed by RawTokenType;
//     `Transaction.imbalances` is not). Shielded and unshielded balances of the SAME token are
//     therefore distinct entries. `balanceKey()` below flattens them to stable strings.

import { inspect } from 'node:util';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';

/** Offer Files expire in roughly one hour — zswap-offer-files SKILL.md §4. This is the single most
 *  operationally significant constraint on the protocol, and it is why packages/dealer-node exists
 *  as a keeper rather than a request handler.
 *
 *  Correction to the skill, learned here: the expiry is not an opaque property of the format. It is
 *  the intent TTL the builder chooses (`initSwap`'s `options.ttl`), and it is readable back off a
 *  deserialized offer. Treat this constant as the DEFAULT we pick, and always account against the
 *  offer's own `expiresAt` rather than against `provedAt + 3600`. */
export const OFFER_FILE_EXPIRY_SECS = 3600;

/** Default gap, in seconds, that must remain between a quote's expiry and its backing Offer File's
 *  expiry — time for the taker to actually submit the settlement. */
export const DEFAULT_SETTLEMENT_MARGIN_SECS = 300;

export type TokenKind = 'shielded' | 'unshielded';

/** One side of a swap: an exact integer quantity of one token. Never a float, never a decimal
 *  string at this layer — decimal strings are a WIRE format (terms.ts), parsed to exact base units
 *  at the boundary. A rounding discrepancy here surfaces as a balance vector that doesn't quite net
 *  to zero, with no obvious cause (zswap-offer-files SKILL.md §7). */
export interface SwapLeg {
  kind: TokenKind;
  /** RawTokenType — 64 hex chars. `ledger.nativeToken().raw` for NIGHT. */
  token: ledger.RawTokenType;
  amount: bigint;
}

/** The subset of a HeadlessWallet that offer construction needs. Kept structural so the dealer node
 *  and the web app can satisfy it from their own wallet plumbing without importing Node-only code. */
export interface OfferWallet {
  facade: WalletFacade;
  /** Raw 32-byte address hex — NOT the bech32m form. */
  unshieldedAddressHex: string;
  secretKeys: { shieldedSecretKeys: ledger.ZswapSecretKeys; dustSecretKey: ledger.DustSecretKey };
  signFn: (payload: Uint8Array) => ledger.Signature;
}

/** A flattened balance vector: `"unshielded:<raw>" | "shielded:<raw>" | "dust"` → signed quantity.
 *  Positive means this offer is LONG that token (it hands the surplus to whoever merges with it);
 *  negative means it is SHORT and needs a counterparty to supply it. */
export type BalanceVector = Record<string, bigint>;

export interface ProvedOffer {
  /** Base64-encoded serialized Offer File — a proved, bound, signed half-transaction. It rides
   *  inside the encrypted point-to-point reveal and is NEVER gossiped: a broadcast Offer File is a
   *  broadcast price, and competing dealers would read every quote (zswap-offer-files SKILL.md §3). */
  offerFileBase64: string;
  /** Epoch seconds when proving completed. */
  provedAt: number;
  /** Epoch seconds when this offer stops being settleable — the intent TTL, read back off the
   *  built transaction rather than assumed. */
  expiresAt: number;
  balanceVector: BalanceVector;
  /** Un-books the coins this offer's construction selected, in THIS wallet's local state. `initSwap`
   *  books them for the offer's whole lifetime (DEALER-NODE.md §5), so an offer that is discarded —
   *  expired out of a warm pool, or a losing quote whose reveal the taker never used — holds its
   *  inputs hostage until the process restarts unless released. Never call it on an offer that may
   *  still be settled: the coins would be offered to other transactions while this one can spend them. */
  release(): Promise<void>;
  /** The unshielded inputs this offer spends, as "intentHash:outputNo". Journaled with the quote: after
   *  a restart the wallet's booking of them is gone, so the node must keep them out of new transactions
   *  itself until the quote is terminal. */
  inputs: string[];
}

/** Unshielded inputs a transaction spends, across every intent and both sections. */
export function inputsOf(tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>): string[] {
  const out: string[] = [];
  for (const [, intent] of tx.intents ?? []) {
    for (const offer of [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]) {
      for (const input of offer?.inputs ?? []) out.push(`${input.intentHash}:${input.outputNo}`);
    }
  }
  return out;
}

export type TermsCheck = { ok: true } | { ok: false; reason: string };

/** THE TAKER'S LAST CHECK BEFORE SETTLING (found 2026-09-14, docs/ROADMAP.md open decisions).
 *
 *  `verifyReveal` proves the revealed terms are signed and open the on-chain commitment. It says
 *  nothing about the Offer File, and the settlement executes the OFFER, not the terms. A dealer could
 *  reveal honest terms beside an Offer File that pays less; Class A cannot catch that, because terms
 *  and commitment agree. So before settling, a taker checks the offer's balance vector is exactly the
 *  trade the terms describe — base leg = size, counter leg = `counterAmountFor(terms)`, nothing else.
 *
 *  `dealerSide` is the side in the TERMS (the dealer's). Balance-vector signs are the dealer half's:
 *  positive = the dealer hands it over (the taker receives it). */
export function offerMatchesTerms(
  offerFileBase64: string,
  expected: { dealerSide: 'buy' | 'sell'; base: SwapLeg; counter: SwapLeg },
): TermsCheck {
  let vector: BalanceVector;
  try {
    vector = tradeableBalance(balanceVectorOf(deserializeOffer(offerFileBase64)));
  } catch (err) {
    return { ok: false, reason: `offer file unreadable: ${(err as Error).message}` };
  }
  const baseKey = `${expected.base.kind}:${expected.base.token}`;
  const counterKey = `${expected.counter.kind}:${expected.counter.token}`;
  const want: BalanceVector =
    expected.dealerSide === 'sell'
      ? { [baseKey]: expected.base.amount, [counterKey]: -expected.counter.amount }
      : { [baseKey]: -expected.base.amount, [counterKey]: expected.counter.amount };
  const keys = new Set([...Object.keys(vector), ...Object.keys(want)]);
  for (const k of keys) {
    if ((vector[k] ?? 0n) !== (want[k] ?? 0n)) {
      return {
        ok: false,
        reason: `offer does not deliver the revealed terms: expected ${showVector(want)}, offer is ${showVector(vector)}`,
      };
    }
  }
  return { ok: true };
}

/** Flattens a `Transaction.imbalances` key (a tagged token-type object) to a stable string.
 *  Shielded and unshielded balances of the same raw token stay distinct, which is correct: they do
 *  not offset each other in the ledger's balance check. */
export function balanceKey(tokenType: ledger.TokenType): string {
  return tokenType.tag === 'dust' ? 'dust' : `${tokenType.tag}:${tokenType.raw}`;
}

/** Reads the real balance vector off a built transaction, across every segment it uses.
 *  `fees` is passed as 0 deliberately: this is the TOKEN balance check, and DUST fee payment is
 *  balanced separately by the submitting party. */
export function balanceVectorOf(
  tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
): BalanceVector {
  const segments = new Set<number>([0, ...(tx.intents?.keys() ?? [])]);
  const out: BalanceVector = {};
  for (const segment of segments) {
    let m: Map<ledger.TokenType, bigint>;
    try {
      m = tx.imbalances(segment, 0n);
    } catch {
      continue; // not a valid segment id for this transaction
    }
    for (const [tokenType, delta] of m) {
      const key = balanceKey(tokenType);
      out[key] = (out[key] ?? 0n) + delta;
    }
  }
  // Drop the zero entries the ledger reports for tokens merely mentioned by the transaction —
  // they carry no information and make two equivalent vectors compare unequal.
  for (const [k, v] of Object.entries(out)) if (v === 0n) delete out[k];
  return out;
}

/** The DUST entry's key in a balance vector. DUST is the FEE token, not a tradeable one. */
export const DUST_KEY = 'dust';

/** The tradeable part of a balance vector — everything except DUST.
 *
 *  This distinction is load-bearing and was found on-chain, not in the types. A fully balanced,
 *  ready-to-submit settlement does NOT have an all-zero balance vector: it carries a deliberate
 *  DUST surplus, which is exactly the fee the block producer consumes. The first live run of
 *  `pnpm run e2e-settle` was refused by this module's own nets-to-zero guard over
 *  `{"dust": 300000000000001}` while every tradeable token had already netted perfectly. Checking
 *  DUST for zero would reject every correct settlement there is. */
export function tradeableBalance(vector: BalanceVector): BalanceVector {
  const { [DUST_KEY]: _dust, ...rest } = vector;
  return rest;
}

/** THE RULE THAT MUST NEVER BE VIOLATED (zswap-offer-files SKILL.md §4).
 *
 *  Committing to a quote backed by an Offer File that expires mid-window means the taker holds a
 *  signed, committed quote that cannot settle. The dealer is bound on-chain for `validitySecs`.
 *  (This text used to say "the taker challenges and the ENTIRE bond is gone"; Class B challenges
 *  were removed 2026-09-14. The failure is now public, attributable evidence against the dealer's
 *  track record rather than a slash — still a failure this check exists to prevent.)
 *
 *  `offerExpiresAt` is the offer's own expiry in epoch seconds — `ProvedOffer.expiresAt`. It used
 *  to take `provedAt` and assume a fixed one-hour life; it takes the real expiry now that we know
 *  the expiry is a TTL the builder chooses and can read back.
 *
 *  The inequality is strict, and deliberately so: chain time is coarse and "just barely enough" is
 *  not enough. */
export function canBackQuote(
  offerExpiresAt: number,
  validitySecs: number,
  settlementMarginSecs = DEFAULT_SETTLEMENT_MARGIN_SECS,
  now = Date.now() / 1000,
): boolean {
  return offerExpiresAt - now > validitySecs + settlementMarginSecs;
}

/** Human-readable rendering of a balance vector — bigints don't survive JSON.stringify. */
export function showVector(vector: BalanceVector): string {
  const entries = Object.entries(vector).map(([k, v]) => `${k}: ${v > 0n ? '+' : ''}${v}`);
  return entries.length ? `{ ${entries.join(', ')} }` : '{}';
}

export class OfferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferError';
  }
}

export interface BuildOfferParams {
  wallet: OfferWallet;
  /** What this party hands over. */
  give: SwapLeg;
  /** What this party wants back, delivered to its own address. Omit for a one-sided half. */
  want?: SwapLeg;
  /** Quote validity window this offer is meant to back, in seconds. Enforced here, not by
   *  convention — see `canBackQuote`. Omit only when the offer backs no on-chain commitment. */
  validitySecs?: number;
  settlementMarginSecs?: number;
  /** Offer lifetime in seconds. Defaults to OFFER_FILE_EXPIRY_SECS. */
  lifetimeSecs?: number;
  /** The chain's LIVE ledger parameters. When supplied, the half is refused if it ALREADY fails the
   *  node's time-to-dismiss rule on its own — measured on Preprod: a 4-input dealer half (932 B,
   *  17.7 ms vs a 15 ms allowance) is unsettleable by any taker, since balancing only adds cost.
   *  Handing such an offer out behind a live quote binds the dealer to a trade that cannot happen. */
  ledgerParameters?: ledger.LedgerParameters;
}

/** Constructs, signs and locally proves one half of a swap, and returns it as transportable bytes.
 *
 *  Proving happens AHEAD OF TIME in the dealer's warm pool, never in the quote hot path
 *  (zswap-offer-files SKILL.md §5) — this function is the thing the warm pool calls.
 *
 *  Note what is NOT here: no price, no pair, no counterparty. Those live in the quote terms, and
 *  the on-chain commitment covers the TERMS, never these serialized bytes — serialization may not
 *  be canonical, and non-canonical bytes would make an honest dealer fail to open their own
 *  commitment, slashing them for nothing (zswap-offer-files SKILL.md §6). */
export async function buildAndProveOffer(params: BuildOfferParams): Promise<ProvedOffer> {
  const { wallet, give, want, validitySecs, settlementMarginSecs, lifetimeSecs, ledgerParameters } = params;

  if (give.amount <= 0n) throw new OfferError('give.amount must be positive');
  if (want && want.amount <= 0n) throw new OfferError('want.amount must be positive');

  const nowSecs = Math.floor(Date.now() / 1000);
  const expiresAt = nowSecs + (lifetimeSecs ?? OFFER_FILE_EXPIRY_SECS);

  // Enforced INSIDE construction, so no caller can skip it by convention.
  if (validitySecs !== undefined && !canBackQuote(expiresAt, validitySecs, settlementMarginSecs, nowSecs)) {
    throw new OfferError(
      `offer would expire inside the quote window: expiresAt=${expiresAt} leaves ` +
        `${expiresAt - nowSecs}s, but backing a ${validitySecs}s quote needs more than ` +
        `${validitySecs + (settlementMarginSecs ?? DEFAULT_SETTLEMENT_MARGIN_SECS)}s. ` +
        'Re-prove the offer before quoting — committing behind it guarantees a slash.',
    );
  }

  const ttl = new Date(expiresAt * 1000);
  const receiver = await receiverAddressFor(wallet, want?.kind ?? 'unshielded');

  // Always pass BOTH keys, `{}` where the leg is empty: the facade drops an unshielded leg whose
  // `desiredInputs.unshielded` key is missing (see header).
  const desiredInputs: { shielded: Record<string, bigint>; unshielded: Record<string, bigint> } = {
    shielded: {},
    unshielded: {},
  };
  desiredInputs[give.kind][give.token] = give.amount;

  const desiredOutputs = want
    ? [{ type: want.kind, outputs: [{ type: want.token, receiverAddress: receiver, amount: want.amount }] }]
    : [];

  const recipe = await wallet.facade.initSwap(
    desiredInputs as never,
    desiredOutputs as never,
    wallet.secretKeys,
    // payFees:false — the SUBMITTING party pays. A dealer's warm-pool offer must not bind the
    // dealer's DUST to a settlement that may never happen, and a proved-and-bound half cannot have
    // fee balancing bolted on afterwards anyway.
    { ttl, payFees: false },
  );

  try {
    // signRecipe, never a hand-rolled intent walk: the stale local signTransactionIntents()
    // workaround is defect W5, and it cost a live `postBond` rejection (node error 192,
    // InputsSignaturesLengthMismatch). See packages/sdk/src/wallet.ts.
    const signed = await wallet.facade.signRecipe(recipe, wallet.signFn);
    // Proves and binds. After this the half is inert, transferable bytes — the property that makes
    // this protocol possible at all (zswap-offer-files SKILL.md §1).
    const finalized = await wallet.facade.finalizeRecipe(signed);
    if (ledgerParameters) {
      // Necessary, not sufficient: passing here does not guarantee the MERGED settlement passes —
      // the taker's inputs and the DUST spends add cost — but failing here guarantees it cannot.
      const dismiss = checkTimeToDismiss(finalized, ledgerParameters);
      if (!dismiss.ok) {
        throw new OfferError(
          `offer half already fails the node's time-to-dismiss rule (Custom error 168) and could never ` +
            `settle: ${dismiss.reason}\n  structure: ${describeIntents(finalized)}\n  ` +
            'Coin selection pulled in too many inputs; back the quote with fewer, larger UTXOs.',
        );
      }
    }
    return {
      offerFileBase64: serializeOffer(finalized),
      provedAt: Math.floor(Date.now() / 1000),
      expiresAt,
      balanceVector: balanceVectorOf(finalized),
      inputs: inputsOf(finalized),
      release: () => wallet.facade.revert(recipe).then(() => undefined, () => undefined),
    };
  } catch (err) {
    // initSwap books the selected UTXOs in local wallet state. If we die after that and before
    // handing the offer out, release them — otherwise the dealer's own coins are stuck pending
    // until restart and the next quote fails with a spurious "insufficient funds".
    await wallet.facade.revert(recipe).catch(() => undefined);
    throw err;
  }
}

/** Base64 wire form for `RevealPlaintext.offerFile` (reveal-channel.ts). */
export function serializeOffer(tx: ledger.FinalizedTransaction): string {
  return Buffer.from(tx.serialize()).toString('base64');
}

/** Inverse of `serializeOffer`.
 *
 *  The signature marker is `'signature'`, NOT `'signature-enabled'` — the class is called
 *  `SignatureEnabled` but its `instance` string is `'signature'`, and getting it wrong surfaces as
 *  a WASM `Invalid signature value.` thrown from inside deserialize, which reads like a corrupt
 *  payload rather than a wrong marker. */
export function deserializeOffer(offerFileBase64: string): ledger.FinalizedTransaction {
  const raw = Buffer.from(offerFileBase64, 'base64');
  if (raw.length === 0) throw new OfferError('offer file is empty');
  try {
    return ledger.Transaction.deserialize(
      'signature',
      'proof',
      'binding',
      raw,
    ) as ledger.FinalizedTransaction;
  } catch (err) {
    throw new OfferError(`offer file did not deserialize as a proved, bound transaction: ${(err as Error).message}`);
  }
}

/** Verifies a combined balance vector nets to zero for every token type before submitting —
 *  zswap-offer-files SKILL.md §2. Client-side sanity check; the chain enforces this regardless, but
 *  finding out on-chain costs a failed transaction and, for a dealer, potentially a bond. */
export function balanceVectorNetsToZero(vectors: Array<Record<string, bigint>>): boolean {
  const totals = new Map<string, bigint>();
  for (const v of vectors) {
    for (const [token, amount] of Object.entries(v)) {
      totals.set(token, (totals.get(token) ?? 0n) + amount);
    }
  }
  return [...totals.values()].every((v) => v === 0n);
}

export interface SettlementResult {
  txId: string;
  /** The merged transaction's balance vector. Its tradeable part is asserted empty before
   *  submission; the DUST entry is the fee provision and is deliberately non-zero. */
  mergedBalanceVector: BalanceVector;
  /** Fee the facade priced this transaction at, and the DUST actually provisioned for it. Returned
   *  rather than merely checked: when a node rejects a settlement these two numbers are the first
   *  thing worth seeing, and reconstructing them after the fact means rebuilding the transaction. */
  fee: bigint;
  dustSurplus: bigint;
  /** ledger-v8's own fee estimate under STATIC default parameters. Reported, never gated on — see
   *  the note in `settleFromOffer`. Useful mainly as a second opinion when a node rejects. */
  ledgerDefaultFee: bigint;
}

export interface SettleParams {
  wallet: OfferWallet;
  /** The dealer's proved half, as it arrived inside the encrypted reveal. */
  offerFileBase64: string;
  /** Offer expiry in epoch seconds, from the reveal. Optional; checked when supplied. */
  expiresAt?: number;
  /** Set false to build and check the settlement without submitting it. */
  submit?: boolean;
  /** The chain's LIVE ledger parameters (`queryLedgerParameters` in indexer.ts). When supplied, the
   *  node's own time-to-dismiss check is run locally before submission, so a settlement the node
   *  would reject with `Custom error: 168` fails here with the numbers instead. Strongly
   *  recommended — see `checkTimeToDismiss`. */
  ledgerParameters?: ledger.LedgerParameters;
}

export type DismissCheck =
  | { ok: true; fee: bigint }
  | { ok: false; reason: string };

/** THE CHECK BEHIND `1010: Invalid Transaction: Custom error: 168` — established from source and
 *  confirmed against a live node in both directions (docs/ROADMAP.md S5).
 *
 *  Midnight node 1.0.2 maps `MalformedError::FeeCalculation` to u8 168. ledger 8.1.2 raises it in
 *  `verify.rs` when `tx.fees(params, enforceTimeToDismiss = true)` fails. Despite the name it is
 *  NOT an underpaid fee (that is 138, BalanceCheckOverspend) and no amount of DUST fixes it. The
 *  failing case is `OutsideTimeToDismiss`: the transaction's modelled validation cost plus its
 *  guaranteed application cost must not exceed `max(time_to_dismiss_per_byte * size,
 *  min_time_to_dismiss)` — live values 2 µs/byte and 15 ms. It is an anti-DoS rule: a transaction
 *  must not be expensive to reject relative to its size.
 *
 *  Every unshielded input, signature and DUST spend adds modelled time. A merged settlement carries
 *  BOTH parties' inputs plus the DUST spends, so it is where this bites — and neither wallet
 *  estimate would ever notice: the dust wallet prices fees with `feesWithMargin`, which does not
 *  enforce time-to-dismiss.
 *
 *  Pass the chain's LIVE parameters. `initialParameters()` uses different cost constants. */
export function checkTimeToDismiss(
  tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
  params: ledger.LedgerParameters,
): DismissCheck {
  try {
    return { ok: true, fee: tx.fees(params, true) };
  } catch (err) {
    return { ok: false, reason: (err as Error).message ?? String(err) };
  }
}

/** Settles a dealer's Offer File: supplies the complementary half from this wallet, asserts the
 *  combined balance vector nets to zero CLIENT-SIDE, and submits.
 *
 *  The counter-half is not negotiated — it is derived from the dealer's own offer. The dealer's
 *  half already states exactly what it is short of, so `balanceFinalizedTransaction` covers that
 *  shortfall from this wallet's coins and routes the dealer's surplus here as change. That is what
 *  makes settlement unilateral: the taker needs no further action from the dealer, only the bytes.
 *  `signRecipe` on a FINALIZED_TRANSACTION recipe signs only the BALANCING transaction, leaving the
 *  dealer's proved half untouched — so the taker never needs, and never gets, the dealer's keys. */
export async function settleFromOffer(params: SettleParams): Promise<SettlementResult> {
  const { wallet, offerFileBase64, expiresAt, submit = true, ledgerParameters } = params;

  // Expiry first: it is the cheapest check and the one that does not need the bytes to be valid.
  const nowSecs = Math.floor(Date.now() / 1000);
  if (expiresAt !== undefined && expiresAt <= nowSecs) {
    throw new OfferError(`offer file expired ${nowSecs - expiresAt}s ago; it cannot be settled`);
  }

  const dealerHalf = deserializeOffer(offerFileBase64);

  const dealerVector = balanceVectorOf(dealerHalf);
  if (Object.keys(dealerVector).length === 0) {
    throw new OfferError(
      'dealer half has an all-zero balance vector — it settles to nothing and is not a trade',
    );
  }

  const ttl = new Date((expiresAt ?? nowSecs + OFFER_FILE_EXPIRY_SECS) * 1000);
  const recipe = await wallet.facade.balanceFinalizedTransaction(dealerHalf, wallet.secretKeys, { ttl });

  let merged: ledger.FinalizedTransaction;
  try {
    const signed = await wallet.facade.signRecipe(recipe, wallet.signFn);
    merged = await wallet.facade.finalizeRecipe(signed);
  } catch (err) {
    await wallet.facade.revert(recipe).catch(() => undefined);
    throw err;
  }

  // THE settlement condition, checked client-side before anything is submitted. The chain enforces
  // it regardless, but finding out on-chain costs a failed transaction — and, for a dealer sitting
  // inside a live quote window, potentially the whole bond.
  const mergedBalanceVector = balanceVectorOf(merged);
  const tradeable = tradeableBalance(mergedBalanceVector);
  if (!balanceVectorNetsToZero([tradeable])) {
    await wallet.facade.revert(recipe).catch(() => undefined);
    throw new OfferError(
      'combined balance vector does not net to zero — refusing to submit: ' + showVector(tradeable),
    );
  }

  // Separately: is the DUST provision plausibly enough to pay the fee? This is a REPORT, not a
  // gate, and that is a deliberate decision taken after a live run contradicted the obvious design.
  //
  // Neither available fee source is trustworthy, and on a real Preprod settlement they disagreed
  // by 3x on the same transaction:
  //
  //   - `facade.calculateTransactionFee` returned 300000000000001 SPECKs — exactly the configured
  //     `additionalFeeOverhead` (3e14) plus one, i.e. precisely what the dust balancer had already
  //     provisioned. Gating on it is vacuous: it can never fail, and it never did.
  //   - `tx.fees(LedgerParameters.initialParameters())` returned 926290000000001 for the same
  //     transaction, but `initialParameters()` is a STATIC DEFAULT, not the live chain's
  //     parameters. Gating on it refused a settlement that the node had already accepted once.
  //
  // Re-balancing DUST against the merged, proven transaction to close the gap was tried and is
  // NOT viable: `balanceFinalizedTransaction(merged, …, { tokenKindsToBalance: ['dust'] })` on an
  // already-dust-balanced transaction hung indefinitely (killed after ~20 minutes, no output).
  //
  // So: report both figures, hard-fail only on the one condition that is unambiguous — no DUST
  // provisioned at all — and otherwise let the node be the authority it already is. The submission
  // error below carries both numbers, which is what a rejection actually needs.
  const fee = await wallet.facade.calculateTransactionFee(merged);
  const ledgerDefaultFee = ledgerDefaultFeeOf(merged);
  const dustSurplus = mergedBalanceVector[DUST_KEY] ?? 0n;
  if (dustSurplus <= 0n) {
    await wallet.facade.revert(recipe).catch(() => undefined);
    throw new OfferError(
      'no DUST was provisioned for the settlement fee — refusing to submit: ' +
        showVector(mergedBalanceVector),
    );
  }

  // The node's time-to-dismiss rule, run locally. Unlike the fee estimates above this IS gated on:
  // its verdict matched the node's on every submission tried (ROADMAP S5), and a failure here is
  // deterministic for these exact bytes — resubmitting cannot help, only a smaller shape can.
  if (ledgerParameters) {
    const dismiss = checkTimeToDismiss(merged, ledgerParameters);
    if (!dismiss.ok) {
      await wallet.facade.revert(recipe).catch(() => undefined);
      throw new OfferError(
        'settlement would be rejected by the node with Custom error 168 (FeeCalculation / ' +
          `OutsideTimeToDismiss): ${dismiss.reason}\n  structure: ${describeIntents(merged)}\n  ` +
          'Not a fee problem — more DUST will not help. The merged transaction carries too many ' +
          'inputs/signatures/DUST spends for its size; a quote sized to need fewer UTXOs settles.',
      );
    }
  }

  if (!submit) {
    await wallet.facade.revert(recipe).catch(() => undefined);
    return { txId: '', mergedBalanceVector, fee, dustSurplus, ledgerDefaultFee };
  }

  let txId: string;
  try {
    txId = await wallet.facade.submitTransaction(merged);
  } catch (err) {
    // A node rejection arrives as an opaque `1010: Invalid Transaction: Custom error: <n>` with a
    // multi-kilobyte byte dump and nothing else. Attach the numbers that actually narrow it down —
    // otherwise reconstructing them means rebuilding the whole transaction.
    throw new OfferError(
      `settlement was rejected on submission (fee ${fee}, DUST provisioned ${dustSurplus}, ` +
        `ledger-default fee estimate ${ledgerDefaultFee}, ` +
        `with-margin(1) ${ledgerFeeWithMarginOf(merged, 1)}, ` +
        `with-margin(5) ${ledgerFeeWithMarginOf(merged, 5)}, ` +
        `merged vector ${showVector(mergedBalanceVector)}, ` +
        `${merged.serialize().length} bytes)\n  structure: ${describeIntents(merged)}\n  ` +
        `node code: ${nodeErrorCode(err) ?? '(none found)'}\n  ${(err as Error).message}`,
    );
  }
  return { txId, mergedBalanceVector, fee, dustSurplus, ledgerDefaultFee };
}

/** The node's `Custom error: N` code, dug out of a submission failure. The facade wraps the node's
 *  reason in an Effect failure whose top-level message is only "Transaction submission error"; the code
 *  sits in nested fields that are neither `.message` nor a plain `.cause` chain (first seen in
 *  probe-fee-calc; a forced A2 submission on 2026-09-14 lost it the same way). */
export function nodeErrorCode(err: unknown): number | undefined {
  const m = inspect(err, { depth: 12, maxStringLength: 20_000 }).match(/Custom error:?\s*(\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** Per-intent shape of a transaction: segment ids, and each segment's unshielded input/output/
 *  signature counts. A node rejection names none of this, and a signature count that does not match
 *  the input count is the shape of the failure that already cost this project one live debugging
 *  session (defect W5, node error 192). */
export function describeIntents(
  tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
): string {
  const parts: string[] = [];
  for (const [segment, intent] of tx.intents ?? []) {
    for (const [section, offer] of [
      ['guaranteed', intent.guaranteedUnshieldedOffer],
      ['fallible', intent.fallibleUnshieldedOffer],
    ] as const) {
      if (!offer) continue;
      parts.push(
        `seg${segment}.${section}: ${offer.inputs.length} in / ${offer.outputs.length} out / ` +
          `${offer.signatures.length} sig`,
      );
    }
    const dustActions = intent.dustActions;
    if (dustActions) {
      parts.push(`seg${segment}.dust: ${dustActions.spends.length} spend(s), ttl ${intent.ttl.toISOString()}`);
    }
  }
  return parts.length ? parts.join('; ') : '(no intents)';
}

/** `tx.fees` under ledger DEFAULT parameters. Not authoritative — `initialParameters()` is a
 *  static default rather than the live chain's parameters — but it is the only second opinion
 *  available, and when it exceeds what was provisioned it is worth reporting alongside a rejection. */
function ledgerDefaultFeeOf(tx: ledger.FinalizedTransaction): bigint {
  try {
    return tx.fees(ledger.LedgerParameters.initialParameters());
  } catch {
    return 0n;
  }
}

/** `tx.feesWithMargin` under ledger DEFAULT parameters, at the wallet's configured
 *  `feeBlocksMargin`. Reported alongside a rejection because the node appears to want headroom over
 *  the bare fee, and this is the only figure that expresses how much. `margin` is an EXPONENT. */
function ledgerFeeWithMarginOf(tx: ledger.FinalizedTransaction, margin: number): bigint {
  try {
    return tx.feesWithMargin(ledger.LedgerParameters.initialParameters(), margin);
  } catch {
    return 0n;
  }
}

/** The address a swap half's own outputs are paid to. */
async function receiverAddressFor(wallet: OfferWallet, kind: TokenKind): Promise<unknown> {
  if (kind === 'unshielded') {
    return new UnshieldedAddress(Buffer.from(wallet.unshieldedAddressHex, 'hex'));
  }
  const state = await wallet.facade.waitForSyncedState();
  return state.shielded.address;
}

export { ledger as zswapLedger };
