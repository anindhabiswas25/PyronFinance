// Presentation of chain facts shared by the public pages: event labels, dealer status, amounts.
// State is always a word plus a tone, never a color alone.

import type { ReactNode } from 'react';
import { Lock, FileText, ShieldAlert, CircleHelp } from 'lucide-react';
import { Chip } from '../../design/primitives';
import type { Tone } from '../../design/tone';
import type { ProtocolEvent } from '../../data/ports';
import type { DealerStatus, QuoteOutcome } from '../../data/selectors';
import { formatDuration, formatUtc } from '../../lib/time';
import { formatUnits } from '../../lib/format';

export const BASE_DECIMALS = 6;

export function fmtBase(value: bigint, maxFraction = 6): string {
  return formatUnits(value, BASE_DECIMALS, { maxFraction });
}

export function TokenAmount({ value, symbol, className }: { value: bigint; symbol: string; className?: string }) {
  return (
    <span className={`tabular-nums whitespace-nowrap ${className ?? ''}`}>
      {fmtBase(value)} <span className="text-mu">{symbol}</span>
    </span>
  );
}

const icon = (node: ReactNode) => node;

export interface EventPresentation {
  label: string;
  tone: Tone;
  icon?: ReactNode;
  size?: bigint;
  detail: string;
}

export function describeEvent(e: ProtocolEvent, now: number, symbol: string): EventPresentation {
  switch (e.kind) {
    case 'bond-posted':
      return { label: 'New bond', tone: 'seal', icon: icon(<Lock size={12} aria-hidden="true" />), size: e.amount, detail: `Can quote up to ${fmtBase(e.maxQuote)} ${symbol}` };
    case 'bond-topped-up':
      return { label: 'Bond topped up', tone: 'seal', size: e.delta, detail: `Bond now ${fmtBase(e.amount)} ${symbol}` };
    case 'withdrawal-requested': {
      const at = Number(e.withdrawableAt);
      return {
        label: 'Withdrawal requested',
        tone: 'warn',
        detail: at > now ? `Stops quoting · withdrawable in ${formatDuration(at - now)}` : 'Stops quoting · withdrawable now',
      };
    }
    case 'bond-withdrawn':
      return { label: 'Bond withdrawn', tone: 'neutral', size: e.amount, detail: 'Settled and slashed counts stay on the record' };
    case 'quote-sealed':
      return { label: 'Quote sealed', tone: 'seal', icon: icon(<Lock size={12} aria-hidden="true" />), size: e.notional, detail: `Binding until ${formatUtc(Number(e.validUntil))}` };
    case 'quote-settled':
      return { label: 'Recorded as settled', tone: 'ok', size: e.notional, detail: 'Recorded by the dealer' };
    case 'quote-released':
      return { label: 'Released · no trade', tone: 'neutral', size: e.notional, detail: 'Expired without a trade' };
    case 'bond-slashed':
      return {
        label: 'Bond slashed',
        tone: 'bad',
        icon: icon(<ShieldAlert size={12} aria-hidden="true" />),
        size: e.amount,
        detail: `Seal mismatch · ${fmtBase(e.taker)} to the taker, ${fmtBase(e.prover)} to the prover, ${fmtBase(e.burned)} burned`,
      };
    case 'note-attached':
      return { label: 'Disclosure note attached', tone: 'neutral', icon: icon(<FileText size={12} aria-hidden="true" />), detail: e.policyTag === 1 ? 'Named recipient · only a hash is on-chain' : `Policy ${e.policyTag}` };
    case 'unrecognized':
      return { label: 'Unrecognized action', tone: 'warn', icon: icon(<CircleHelp size={12} aria-hidden="true" />), detail: e.detail };
  }
}

export function EventChip({ e, now, symbol }: { e: ProtocolEvent; now: number; symbol: string }) {
  const p = describeEvent(e, now, symbol);
  return (
    <Chip tone={p.tone} icon={p.icon}>
      {p.label}
    </Chip>
  );
}

const STATUS: Record<DealerStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'ok' },
  withdrawing: { label: 'Withdrawing', tone: 'warn' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  slashed: { label: 'Slashed', tone: 'bad' },
  inactive: { label: 'Inactive', tone: 'neutral' },
};

export function DealerStatusChip({ status }: { status: DealerStatus }) {
  const s = STATUS[status];
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

const OUTCOME: Record<QuoteOutcome, { label: string; tone: Tone }> = {
  settled: { label: 'Recorded as settled', tone: 'ok' },
  released: { label: 'Released', tone: 'neutral' },
  slashed: { label: 'Slashed', tone: 'bad' },
  live: { label: 'Live', tone: 'seal' },
  expired: { label: 'Expired · awaiting release', tone: 'warn' },
};

export function OutcomeChip({ outcome, suffix }: { outcome: QuoteOutcome; suffix?: ReactNode }) {
  const o = OUTCOME[outcome];
  return (
    <Chip tone={o.tone}>
      {o.label}
      {suffix}
    </Chip>
  );
}

/** Failure evidence has no public source yet (open decision) — never render a fake 0. */
export function FailuresUnknown() {
  return (
    <span className="text-mu" title="Published failure evidence has no public source yet, so this count is unknown — not zero.">
      —<span className="sr-only"> (unknown: no public source of failure evidence yet)</span>
    </span>
  );
}
