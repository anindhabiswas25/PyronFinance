// Inventory shaping plan for the dealer node's keeper — DEALER-NODE.md §5.
//
// Two live findings pull in opposite directions, and this planner is where they meet:
//   * MERGE: coin selection is smallest-first, so every coin smaller than an offer's give amount is swept
//     into it, and a half with more than one input fails the node's time-to-dismiss rule (ROADMAP S5).
//   * SPLIT: an offer books a WHOLE coin until its Offer File expires (up to an hour). With two TESTUSD
//     coins, M3 run #2 answered two quotes, then failed every build with "Insufficient funds" until the
//     offers expired (2026-09-14).
//
// The target shape per token is therefore a ladder: `targetCoins` coins, each large enough to back one
// rung on its own, and no dust small enough to be swept into a half. Pure function, no I/O: the keeper
// in bin.ts executes whatever it returns with `inventory.ts`.

export interface PlanCoin {
  ref: string;
  value: bigint;
}

export type InventoryPlan =
  | { action: 'none'; reason: string }
  | { action: 'merge'; refs: string[]; total: bigint; reason: string }
  | { action: 'split'; source: string; pieces: bigint[]; reason: string };

export interface PlanInput {
  /** Every available coin of ONE token. Coins booked by live offers must already be excluded. */
  coins: PlanCoin[];
  /** The largest amount a single offer of this token gives. A coin backs a quote if value >= rungAmount. */
  rungAmount: bigint;
  /** How many coins should each be able to back a quote on their own. */
  targetCoins: number;
  /** Merge when more coins than this exist. */
  consolidateAbove: number;
  /** Each split piece is rungAmount × pieceFactorBps / 10000 (default 1.5×), so a price move does not
   *  push a rung past its coin. */
  pieceFactorBps?: bigint;
}

export function planInventory(input: PlanInput): InventoryPlan {
  const { rungAmount, targetCoins, consolidateAbove } = input;
  if (rungAmount <= 0n) return { action: 'none', reason: 'rung amount is zero' };
  const factor = input.pieceFactorBps ?? 15_000n;
  const piece = (rungAmount * factor + 9_999n) / 10_000n;
  const coins = [...input.coins].sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));

  // Dust first: any coin smaller than a rung will be swept into an offer as a second input.
  const dust = coins.filter((c) => c.value < rungAmount);
  if (dust.length >= 2 || coins.length > consolidateAbove) {
    // Merge the smallest coins, at most 3 (a larger merge risks its own time-to-dismiss refusal).
    const batch = coins.slice(0, Math.min(3, coins.length));
    if (batch.length >= 2) {
      return {
        action: 'merge',
        refs: batch.map((c) => c.ref),
        total: batch.reduce((a, c) => a + c.value, 0n),
        reason: dust.length >= 2 ? `${dust.length} coins smaller than a rung` : `${coins.length} coins > ${consolidateAbove}`,
      };
    }
  }

  const backing = coins.filter((c) => c.value >= rungAmount);
  const missing = targetCoins - backing.length;
  if (missing <= 0) return { action: 'none', reason: `${backing.length} coins can each back a rung (target ${targetCoins})` };

  const largest = coins[coins.length - 1];
  if (!largest) return { action: 'none', reason: 'no coins to split' };
  // A split is a self-transfer, and the wallet funds it SMALLEST coin first. If the pieces add up to no more
  // than the smaller coins combined, selection never touches the largest coin: it spends existing small
  // coins to recreate coins of the same size — a real transaction that changes nothing. Found live in M3
  // run #3: "split … 1 in / 1 out" every tick, one 1,500 coin recycled into another. So the split total must
  // exceed the sum of every smaller coin, which forces the largest coin in and makes each split add coins.
  const smallerSum = coins.slice(0, -1).reduce((a, c) => a + c.value, 0n);
  const forcing = Number(smallerSum / piece) + 1; // pieces needed so that pieces × piece > smallerSum
  const spare = largest.value + smallerSum - rungAmount; // everything selection may draw, keeping one rung as change
  const affordable = spare > 0n ? Number(spare / piece) : 0;
  const count = Math.min(Math.max(missing, forcing), affordable, 8);
  if (count <= 0 || count < forcing) {
    return {
      action: 'none',
      reason: `need ${missing} more backing coin(s) but a split must exceed the ${smallerSum} held in smaller coins, and the largest (${largest.value}) cannot fund ${forcing} × ${piece} pieces`,
    };
  }
  return {
    action: 'split',
    source: largest.ref,
    pieces: Array.from({ length: count }, () => piece),
    reason: `${backing.length} backing coin(s) < target ${targetCoins}`,
  };
}
