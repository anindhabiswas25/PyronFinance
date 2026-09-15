// Hex <-> bytes without the SDK (public pages must not load it).

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error('not a hex string');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function isHex32(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

export function normalizeHex(s: string): string {
  return (s.startsWith('0x') ? s.slice(2) : s).toLowerCase();
}
