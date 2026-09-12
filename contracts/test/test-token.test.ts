// TestToken.compact — simulator tests. See contracts/test/harness.ts for why the simulator exists
// and, more importantly, for what it does NOT prove: circuit logic only, never chain integration.
//
// TestToken is testnet scaffolding (see the contract header), so these tests are deliberately
// small. They cover the two things that would waste real debugging time if wrong: the mint guards,
// and the fact that the minted token type is CONTRACT-SCOPED — which is what stops the test asset
// from colliding with native tNIGHT and is the entire reason a two-entry balance vector works.

import { describe, expect, it } from 'vitest';
import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { rawTokenType, nativeToken } from '@midnight-ntwrk/ledger-v8';
import { Contract, ledger, type Ledger } from '../managed/test-token/contract/index.js';

const COIN_PK = '0'.repeat(64);
const CONTRACT_ADDR = dummyContractAddress();

/** Mirrors the nullary pure circuits in TestToken.compact, so a contract change that forgets to
 *  update them fails here instead of drifting silently. */
const MAX_MINT_PER_CALL = 1_000_000_000_000n;
const DOMAIN_SEP = 'otc:testusd:v1';

/** The domain separator exactly as `pad(32, "...")` produces it: right-padded with zero bytes. */
function paddedDomainSep(): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(DOMAIN_SEP));
  return out;
}

class TokenSim {
  private state: unknown;

  constructor() {
    const contract = new Contract<Record<string, never>>({});
    const init = contract.initialState(createConstructorContext({}, COIN_PK));
    this.state = init.currentContractState.data;
  }

  get ledger(): Ledger {
    return ledger(this.state as never);
  }

  mint(amount: bigint, recipient: Uint8Array): void {
    const contract = new Contract<Record<string, never>>({});
    const ctx = createCircuitContext<Record<string, never>>(
      CONTRACT_ADDR,
      COIN_PK,
      this.state as never,
      {},
      undefined,
      undefined,
      0,
    );
    const fn = contract.impureCircuits.mint as (
      c: unknown,
      ...a: unknown[]
    ) => { context: { currentQueryContext: { state: unknown } } };
    const res = fn(ctx, amount, recipient);
    this.state = res.context.currentQueryContext.state;
  }

  /** State must be left untouched by a reverted call. */
  expectRevert(amount: bigint, recipient: Uint8Array): string {
    const before = this.state;
    try {
      this.mint(amount, recipient);
    } catch (err) {
      this.state = before;
      return (err as Error).message;
    }
    throw new Error('expected mint to revert, but it succeeded');
  }
}

const ALICE = new Uint8Array(32).fill(0xa1);
const BOB = new Uint8Array(32).fill(0xb0);

describe('TestToken.mint — the faucet guards', () => {
  // NOTE: a TOP-LEVEL `Counter` ledger field surfaces as a plain bigint, not as an object with
  // `.read()`. That differs from `Map<Bytes<32>, Counter>` in OTCProtocol.compact, where the
  // lookup returns a Counter and `.read()` IS required. Easy to get backwards.
  it('mints and accumulates totalMinted across callers', () => {
    const sim = new TokenSim();
    sim.mint(1000n, ALICE);
    sim.mint(2500n, BOB);
    expect(sim.ledger.totalMinted).toBe(3500n);
    expect(sim.ledger.mintCount).toBe(2n);
  });

  it('rejects a zero amount', () => {
    const sim = new TokenSim();
    expect(sim.expectRevert(0n, ALICE)).toMatch(/Mint amount must be positive/);
    expect(sim.ledger.totalMinted).toBe(0n);
    expect(sim.ledger.mintCount).toBe(0n);
  });

  it('accepts exactly the per-call cap and rejects one base unit more', () => {
    const sim = new TokenSim();
    sim.mint(MAX_MINT_PER_CALL, ALICE);
    expect(sim.ledger.totalMinted).toBe(MAX_MINT_PER_CALL);
    expect(sim.expectRevert(MAX_MINT_PER_CALL + 1n, ALICE)).toMatch(/exceeds per-call cap/);
    // The rejected call must not have moved the ledger.
    expect(sim.ledger.totalMinted).toBe(MAX_MINT_PER_CALL);
    expect(sim.ledger.mintCount).toBe(1n);
  });

  it('is permissionless — anyone may mint to any address', () => {
    // Deliberate: no admin key, for the same reason OTCProtocol has none. Asserted so that adding
    // one later is a visible decision rather than a quiet drift.
    const sim = new TokenSim();
    sim.mint(1n, ALICE);
    sim.mint(1n, BOB);
    expect(sim.ledger.mintCount).toBe(2n);
  });
});

describe('the minted token type is contract-scoped', () => {
  it('is NOT native tNIGHT — otherwise the two legs would collapse into one entry', () => {
    // This is the property the whole two-asset settlement rests on. If the minted type equalled
    // the native type, the balance vector would net to zero with a single entry and the e2e would
    // prove nothing it did not already prove.
    const minted = rawTokenType(paddedDomainSep(), CONTRACT_ADDR);
    expect(minted).not.toBe(nativeToken().raw);
  });

  it('differs per deploying contract address, so two deployments cannot collide', () => {
    const a = rawTokenType(paddedDomainSep(), CONTRACT_ADDR);
    const b = rawTokenType(paddedDomainSep(), '11'.repeat(32));
    expect(a).not.toBe(b);
  });

  it('differs per domain separator', () => {
    const a = rawTokenType(paddedDomainSep(), CONTRACT_ADDR);
    const other = new Uint8Array(32);
    other.set(new TextEncoder().encode('otc:other:v1'));
    expect(a).not.toBe(rawTokenType(other, CONTRACT_ADDR));
  });
});
