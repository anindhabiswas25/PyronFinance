import { useMemo } from 'react';
import type { CompareQuote } from '../../lib/compare';
import type { RfqState } from '../../state/rfq';

/** Revealed quotes, and seal/offer mismatches, as comparison rows. Nothing unverified gets here. */
export function useCompareQuotes(state: RfqState, now: number): CompareQuote[] {
  return useMemo(
    () =>
      state.order
        .map((id) => state.quotes[id])
        .filter((q) => q && q.verification === 'on-chain' && (q.reveal === 'revealed' || q.reveal === 'seal-mismatch' || q.reveal === 'offer-mismatch'))
        .map((q) => ({
          quoteId: q.quoteId,
          dealerCmt: q.dealerCmt,
          amount: q.amount ?? 0n,
          price: q.terms?.price ?? '0',
          bond: q.bond ?? 0n,
          notional: q.notional ?? 0n,
          settled: q.settled ?? 0n,
          slashed: q.slashed ?? 0n,
          validUntil: q.validUntil ?? 0,
          firstSeen: q.firstSeen,
          state: q.reveal === 'seal-mismatch' ? 'seal-mismatch' : q.reveal === 'offer-mismatch' ? 'offer-mismatch' : (q.validUntil ?? 0) > now ? 'valid' : 'expired',
          offer: q.offer,
        })),
    [state.order, state.quotes, now],
  );
}
