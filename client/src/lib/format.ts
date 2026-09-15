// Amount and identifier formatting. Amounts are bigint base units in and strings out; nothing here
// ever converts an amount to Number.

export class AmountFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountFormatError';
  }
}

export interface FormatUnitsOptions {
  /** Most fraction digits to show. Defaults to `decimals` (exact). */
  maxFraction?: number;
  /** Fewest fraction digits to show; trailing zeros beyond this are trimmed. Default 0. */
  minFraction?: number;
  /** Thousands separators. Default true. */
  group?: boolean;
  /** How digits beyond `maxFraction` are dropped. Default 'down' (toward zero): a display never
   *  shows more than the amount. */
  round?: 'down' | 'up' | 'half-up';
}

const MINUS = '−';

export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `1234567890n, 6` → "1,234.56789". */
export function formatUnits(value: bigint, decimals: number, options: FormatUnitsOptions = {}): string {
  const { maxFraction = decimals, minFraction = 0, group = true, round = 'down' } = options;
  if (decimals < 0 || !Number.isInteger(decimals)) throw new AmountFormatError('decimals must be a non-negative integer');
  const negative = value < 0n;
  let abs = negative ? -value : value;
  const shown = Math.min(Math.max(maxFraction, 0), decimals);

  if (shown < decimals) {
    const divisor = 10n ** BigInt(decimals - shown);
    const remainder = abs % divisor;
    abs -= remainder;
    const bump = round === 'up' ? remainder > 0n : round === 'half-up' ? remainder * 2n >= divisor : false;
    if (bump) abs += divisor;
  }

  const scale = 10n ** BigInt(decimals);
  const whole = (abs / scale).toString();
  let fraction = decimals > 0 ? (abs % scale).toString().padStart(decimals, '0').slice(0, shown) : '';
  const keep = Math.min(Math.max(minFraction, 0), shown);
  while (fraction.length > keep && fraction.endsWith('0')) fraction = fraction.slice(0, -1);

  const body = (group ? groupThousands(whole) : whole) + (fraction ? `.${fraction}` : '');
  return negative && abs !== 0n ? `${MINUS}${body}` : body;
}

/** Strict parse of a user-typed decimal string into base units. Accepts "1", "1.5", "0.000001". */
export function parseUnits(input: string, decimals: number): bigint {
  const s = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) throw new AmountFormatError(`"${input}" is not a decimal amount`);
  const [whole = '', fraction = ''] = s.split('.');
  if (fraction.length > decimals) throw new AmountFormatError(`at most ${decimals} decimal places`);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

/** Whether `input` is an acceptable partial amount while typing ("", "12", "12.", "12.34"). Used to
 *  block invalid keystrokes rather than to validate a finished value. */
export function isAmountInput(input: string, decimals: number): boolean {
  return new RegExp(`^\\d*(\\.\\d{0,${decimals}})?$`).test(input);
}

/** "abcd…ef" — the first four and last two characters of a hex identifier. */
export function truncateHash(hex: string, head = 4, tail = 2): string {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(h.length - tail)}`;
}

/** Signed basis points as a percentage with two decimals: -110n → "−1.10%", 0n → "0.00%". */
export function formatBpsAsPercent(bps: bigint, options: { signed?: boolean } = {}): string {
  const negative = bps < 0n;
  const abs = negative ? -bps : bps;
  const text = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}%`;
  if (negative) return `${MINUS}${text}`;
  return options.signed && abs > 0n ? `+${text}` : text;
}

/** numerator / denominator as a percentage with one decimal, rounded half up: (1, 3) → "33.3%". */
export function formatRatioPercent(numerator: bigint, denominator: bigint): string {
  if (denominator <= 0n) return '—';
  const tenths = (numerator * 1000n * 2n + denominator) / (denominator * 2n);
  return `${formatUnits(tenths, 1, { minFraction: 1 })}%`;
}

export function formatCount(n: bigint | number): string {
  return groupThousands(n.toString());
}
