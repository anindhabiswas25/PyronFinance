// JSON that survives bigint and Uint8Array. Every persisted value in the client goes through this:
// a bigint that silently became a Number (or threw in JSON.stringify) is exactly the precision bug
// amounts must never have.
//
//   123n              -> {"$bigint":"123"}
//   Uint8Array [1,2]  -> {"$bytes":"0102"}

const BIGINT = '$bigint';
const BYTES = '$bytes';

function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function replacer(this: unknown, key: string, value: unknown): unknown {
  // JSON.stringify hands the replacer the already-toJSON'd value; typed arrays have no toJSON, but
  // read the holder anyway so this never depends on that.
  const raw = key === '' ? value : (this as Record<string, unknown>)[key];
  if (typeof raw === 'bigint') return { [BIGINT]: raw.toString() };
  if (raw instanceof Uint8Array) return { [BYTES]: toHex(raw) };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1) {
      const v = (value as Record<string, unknown>)[keys[0]];
      if (keys[0] === BIGINT && typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
      if (keys[0] === BYTES && typeof v === 'string' && /^([0-9a-f]{2})*$/.test(v)) return fromHex(v);
    }
  }
  return value;
}

export function stringify(value: unknown, space?: number): string {
  return JSON.stringify(value, replacer, space);
}

export function parse<T = unknown>(text: string): T {
  return JSON.parse(text, reviver) as T;
}
