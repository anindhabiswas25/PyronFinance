// Plain meanings for node rejection codes the protocol has actually met (docs/ROADMAP.md S4, S5, W5,
// M3 run #3). Anything else is shown as its number with a generic meaning, never as a byte dump.

const MEANINGS: Record<number, string> = {
  168: 'The transaction is too expensive to validate for its size (time-to-dismiss). Usually too many coins are being spent; merging coins first helps.',
  138: 'The fee provided was not enough.',
  192: 'The number of signatures does not match the coins being spent.',
  104: 'The node reported an error, but this code has also been seen for transactions that did land. Check the chain before trying again.',
};

export function nodeErrorMeaning(code: number | undefined): string {
  if (code === undefined) return 'The network refused the transaction without a code.';
  return MEANINGS[code] ?? `The node rejected the transaction (code ${code}).`;
}
