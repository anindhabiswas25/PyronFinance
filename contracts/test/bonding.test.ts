// Bonding lifecycle — Pillar 1 (permissionless entry) and the withdrawal timelock that makes
// the anti-last-look guarantee enforceable (docs/CONTRACTS.md §5.1, §6, §8).

import { describe, expect, it } from 'vitest';
import {
  OTCSim, bondDealer, dealer, bytes32, T0,
  BOND_WITHDRAW_DELAY, TIME_SLACK, DEALER_SK, QUOTE_PK, NOTIONAL
} from './harness.js';
import { dealerCommitment } from '../../packages/sdk/src/domain.js';

describe('postBond — permissionless entry', () => {
  it('anyone can bond; no approval step exists', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim, 5000n);

    const bond = sim.ledger.bonds.lookup(cmt);
    expect(bond.amount).toBe(5000n);
    expect(bond.active).toBe(true);
    expect(bond.liveQuotes).toBe(0n);
    expect(bond.withdrawRequested).toBe(0n);
  });

  it('derives the on-chain commitment exactly as the SDK does', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    expect(sim.ledger.bonds.member(dealerCommitment(DEALER_SK))).toBe(true);
  });

  it('rejects a second bond from the same dealer', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'postBond', 1000n, QUOTE_PK);
    expect(msg).toMatch(/already bonded/);
  });

  it('rejects a zero bond — there is no flat minimum, but a bond must back something', () => {
    const sim = new OTCSim();
    const msg = sim.expectRevert(dealer(DEALER_SK), 'postBond', 0n, QUOTE_PK);
    expect(msg).toMatch(/Bond must be positive/);
  });

  it('starts settled and slashed counters at zero', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    expect(sim.ledger.settled.lookup(cmt).read()).toBe(0n);
    expect(sim.ledger.slashed.lookup(cmt).read()).toBe(0n);
  });
});

describe('topUpBond', () => {
  it('adds to an existing bond', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim, 1000n);
    sim.call(dealer(DEALER_SK), 'topUpBond', 500n);
    expect(sim.ledger.bonds.lookup(cmt).amount).toBe(1500n);
  });

  it('rejects a non-dealer', () => {
    const sim = new OTCSim();
    const msg = sim.expectRevert(dealer(bytes32(0xee)), 'topUpBond', 500n);
    expect(msg).toMatch(/Not a dealer/);
  });
});

describe('requestBondWithdrawal — caller-supplied `now` is chain-bounded', () => {
  it('accepts a truthful timestamp and deactivates the dealer', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(T0));

    const bond = sim.ledger.bonds.lookup(cmt);
    expect(bond.withdrawRequested).toBe(BigInt(T0));
    // Deactivation is the point: a withdrawing dealer must not take on new obligations.
    expect(bond.active).toBe(false);
  });

  it('accepts a timestamp within TIME_SLACK of chain time', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(T0 - TIME_SLACK + 1));
  });

  it('rejects a timestamp older than TIME_SLACK', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    const msg = sim.expectRevert(
      dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(T0 - TIME_SLACK - 1),
    );
    expect(msg).toMatch(/too far in the past/);
  });

  it('rejects a future timestamp — no back-dating the timelock', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(T0 + 1));
    expect(msg).toMatch(/in the future/);
  });
});

describe('withdrawBond — timelock and outstanding obligations', () => {
  const RECIPIENT = bytes32(0xaa);

  it('rejects withdrawal before the timelock elapses', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(T0));

    sim.advanceTo(T0 + BOND_WITHDRAW_DELAY - 1);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'withdrawBond', RECIPIENT);
    expect(msg).toMatch(/Timelock not elapsed/);
  });

  it('permits withdrawal exactly at the timelock boundary', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(T0));

    sim.advanceTo(T0 + BOND_WITHDRAW_DELAY);
    sim.call(dealer(DEALER_SK), 'withdrawBond', RECIPIENT);
    expect(sim.ledger.bonds.member(cmt)).toBe(false);
  });

  it('rejects withdrawal that was never requested', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    sim.advanceTo(T0 + BOND_WITHDRAW_DELAY);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'withdrawBond', RECIPIENT);
    expect(msg).toMatch(/No withdrawal requested/);
  });

  it('counters survive withdrawal — a slash cannot be laundered by re-bonding (§8)', () => {
    const sim = new OTCSim();
    const cmt = bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(T0));
    sim.advanceTo(T0 + BOND_WITHDRAW_DELAY);
    sim.call(dealer(DEALER_SK), 'withdrawBond', RECIPIENT);

    expect(sim.ledger.bonds.member(cmt)).toBe(false);
    // The commitment's history must outlive the bond itself.
    expect(sim.ledger.settled.member(cmt)).toBe(true);
    expect(sim.ledger.slashed.member(cmt)).toBe(true);
  });

  it('blocks withdrawal while a quote is still live', () => {
    const sim = new OTCSim();
    bondDealer(sim);
    sim.call(dealer(DEALER_SK), 'commitQuote', bytes32(1), bytes32(2), BigInt(T0 + 600), NOTIONAL);
    sim.call(dealer(DEALER_SK), 'requestBondWithdrawal', BigInt(T0));

    sim.advanceTo(T0 + BOND_WITHDRAW_DELAY);
    const msg = sim.expectRevert(dealer(DEALER_SK), 'withdrawBond', RECIPIENT);
    expect(msg).toMatch(/Live quote commitments outstanding/);
  });
});
