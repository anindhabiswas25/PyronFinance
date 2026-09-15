// Every desk action's gate: allowed, or blocked with the reason and, where it is a matter of time,
// when it opens. Mirrors the contract's assertions (OTCProtocol.compact §5.1–5.2) so a blocked action
// is explained before a transaction could fail. Pure: no SDK, no React.

import type { BondView } from '../../data/ports';
import type { DealerQuote } from '../../data/selectors';
import { BOND_WITHDRAW_DELAY_SECS, MAX_QUOTE_VALIDITY_SECS, NOTIONAL_CAP_K, PROOF_GRACE_PERIOD_SECS, minBondForNotional } from '../../lib/bond';
import { formatUnits } from '../../lib/format';
import { formatUtc } from '../../lib/time';

export type Gate = { ok: true } | { ok: false; reason: string; until?: number };

const OK: Gate = { ok: true };
const no = (reason: string, until?: number): Gate => ({ ok: false, reason, until });
const base = (v: bigint) => formatUnits(v, 6, { maxFraction: 6 });

export interface Actor {
  hasKey: boolean;
  backedUp: boolean;
  walletConnected: boolean;
}

/** What every signed dealer action needs, checked after the chain's own conditions. */
export function actorGate(a: Actor): Gate {
  if (!a.hasKey) return no('Unlock your dealer key on the Keys tab first.');
  if (!a.backedUp) return no('Save a backup of your dealer key first (Keys tab). A lost key strands the bond.');
  if (!a.walletConnected) return no('Connect a wallet: it pays the fee and holds the tNIGHT.');
  return OK;
}

export type BondAction = 'post' | 'topUp' | 'requestWithdrawal' | 'withdraw';

export function bondGates(bond: BondView | undefined, now: number, actor: Actor): Record<BondAction, Gate> {
  const who = actorGate(actor);
  const then = (g: Gate): Gate => (g.ok ? who : g);
  const requested = bond ? Number(bond.withdrawRequested) : 0;
  const unlockAt = requested + BOND_WITHDRAW_DELAY_SECS;
  return {
    post: then(bond ? no('This key is already bonded. Top up instead.') : OK),
    topUp: then(bond ? OK : no('Post a bond first.')),
    requestWithdrawal: then(
      !bond ? no('Nothing is bonded.') : requested > 0 ? no(`A withdrawal was already requested on ${formatUtc(requested)}.`) : OK,
    ),
    withdraw: then(
      !bond
        ? no('Nothing is bonded.')
        : requested === 0
          ? no('Request a withdrawal first. The bond unlocks 24 h after the request.')
          : now < unlockAt
            ? no(`The 24 h timelock runs until ${formatUtc(unlockAt)}.`, unlockAt)
            : bond.liveQuotes > 0n
              ? no(`${bond.liveQuotes} quote${bond.liveQuotes === 1n ? ' is' : 's are'} still live. Each must be recorded as settled or released first.`)
              : OK,
    ),
  };
}

/** `releaseExpiredQuote` is permissionless: no key or backup needed, only a wallet for the fee. */
export function releaseGate(q: { validUntil: bigint; resolved: boolean }, now: number, walletConnected: boolean): Gate {
  const validUntil = Number(q.validUntil);
  const opensAt = validUntil + PROOF_GRACE_PERIOD_SECS;
  if (q.resolved) return no('Already resolved.');
  if (now < validUntil) return no(`Still valid until ${formatUtc(validUntil)}; the dealer is bound until then.`, validUntil);
  if (now < opensAt) return no(`The fraud-proof grace period is open until ${formatUtc(opensAt)}.`, opensAt);
  if (!walletConnected) return no('Connect a wallet to pay the fee.');
  return OK;
}

export interface ManualQuoteFacts {
  bond?: BondView;
  notional: bigint;
  validitySecs: number;
  rfqExpiry: number;
  now: number;
  priceValid: boolean;
  actor: Actor;
}

export function manualQuoteGate(f: ManualQuoteFacts): Gate {
  if (f.rfqExpiry <= f.now) return no('This request has expired.');
  if (!f.priceValid) return no('Enter a price above zero, with up to 6 decimals.');
  if (!f.bond) return no('Post a bond before quoting.');
  if (!f.bond.active) return no('Your bond is not active (withdrawing or slashed), so the contract refuses new quotes.');
  if (f.notional > f.bond.amount * NOTIONAL_CAP_K) {
    return no(`This size needs a bond of at least ${base(minBondForNotional(f.notional))} tNIGHT; yours is ${base(f.bond.amount)}.`);
  }
  if (f.validitySecs <= 0 || f.validitySecs > MAX_QUOTE_VALIDITY_SECS) return no('A quote can be valid for at most 15 minutes.');
  return actorGate(f.actor);
}

export interface DeskAlert {
  tone: 'bad' | 'warn' | 'seal' | 'neutral';
  title: string;
  detail: string;
}

export function deskAlerts(bond: BondView | undefined, slashed: bigint, quotes: readonly DealerQuote[], now: number): DeskAlert[] {
  const out: DeskAlert[] = [];
  if (!bond) {
    out.push(
      slashed > 0n
        ? { tone: 'bad', title: 'No bond on-chain', detail: 'This key was slashed or has withdrawn. Its record stays public.' }
        : { tone: 'neutral', title: 'No bond on-chain', detail: 'Post a bond on the Bond tab to start quoting.' },
    );
  } else if (bond.amount === 0n && !bond.active) {
    out.push({ tone: 'bad', title: 'Bond slashed', detail: 'A fraud proof took the whole bond and deactivated this dealer.' });
  } else if (bond.withdrawRequested > 0n) {
    const at = Number(bond.withdrawRequested) + BOND_WITHDRAW_DELAY_SECS;
    out.push({
      tone: 'warn',
      title: 'Withdrawal requested',
      detail: `No new quotes. Withdrawable ${at > now ? `after ${formatUtc(at)}` : 'now'}${bond.liveQuotes > 0n ? `, once ${bond.liveQuotes} live quote${bond.liveQuotes === 1n ? '' : 's'} resolve` : ''}.`,
    });
  }
  const expired = quotes.filter((q) => q.outcome === 'expired');
  const releasable = expired.filter((q) => now >= Number(q.validUntil) + PROOF_GRACE_PERIOD_SECS);
  if (releasable.length) {
    out.push({ tone: 'warn', title: `${releasable.length} expired quote${releasable.length === 1 ? '' : 's'} can be released`, detail: 'Each still counts as live against your bond until released (Quotes tab).' });
  }
  if (expired.length > releasable.length) {
    const n = expired.length - releasable.length;
    out.push({ tone: 'neutral', title: `${n} expired quote${n === 1 ? '' : 's'} in the grace period`, detail: 'Releasable one hour after each expired, once no fraud proof can arrive.' });
  }
  return out;
}
