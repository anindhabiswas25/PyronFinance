// Sides. The RFQ carries the TAKER's side of the base asset (RELAY.md §3.1); reveal terms carry the
// DEALER's. Taker sells ⇔ terms.side === 'buy' ⇔ the taker RECEIVES counterAmountFor(terms).

export type Side = 'buy' | 'sell';

export function oppositeSide(side: Side): Side {
  return side === 'buy' ? 'sell' : 'buy';
}

/** The dealer's side a valid reveal must carry for this RFQ. */
export function expectedDealerSide(takerSide: Side): Side {
  return oppositeSide(takerSide);
}

export function isValidDealerSide(takerSide: Side, dealerSide: Side): boolean {
  return dealerSide === expectedDealerSide(takerSide);
}

/** Whether the counter-asset amount is what the taker receives (true) or pays (false). */
export function takerReceivesCounter(takerSide: Side): boolean {
  return takerSide === 'sell';
}

/** "You receive" when selling the base asset, "You pay" when buying it. */
export function counterLabel(takerSide: Side): 'You receive' | 'You pay' {
  return takerReceivesCounter(takerSide) ? 'You receive' : 'You pay';
}
