// Times are unix seconds. (Seconds are counts, not amounts, so Number is fine here.)

export function nowSecs(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000);
}

/** 125 → "2:05"; 3725 → "1:02:05". Negative clamps to "0:00". */
export function formatClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** 45 → "45 s"; 125 → "2 min 5 s"; 3840 → "1 h 4 min"; 90000 → "1 d 1 h". */
export function formatDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** Spoken form for screen readers: 125 → "2 minutes 5 seconds". */
export function formatDurationWords(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (h) parts.push(part(h, 'hour'));
  if (m) parts.push(part(m, 'minute'));
  if (r || parts.length === 0) parts.push(part(r, 'second'));
  return parts.join(' ');
}

/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function formatAgo(tsSecs: number, now: number): string {
  const d = now - tsSecs;
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
}

/** "2026-09-15 08:20:38 UTC". */
export function formatUtc(tsSecs: number): string {
  return `${new Date(tsSecs * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}
