// Status tones. State is always words plus form; a tone only reinforces them.

export type Tone = 'ok' | 'seal' | 'bad' | 'warn' | 'neutral';

export const toneText: Record<Tone, string> = {
  ok: 'text-ok',
  seal: 'text-seal',
  bad: 'text-bad',
  warn: 'text-warn',
  neutral: 'text-mu',
};

export const toneSoft: Record<Tone, string> = {
  ok: 'bg-okbg text-ok',
  seal: 'bg-sealbg text-seal',
  bad: 'bg-badbg text-bad',
  warn: 'bg-warnbg text-warn',
  neutral: 'bg-s2 text-mu',
};

export const toneDot: Record<Tone, string> = {
  ok: 'bg-ok',
  seal: 'bg-seal',
  bad: 'bg-bad',
  warn: 'bg-warn',
  neutral: 'bg-dim',
};
