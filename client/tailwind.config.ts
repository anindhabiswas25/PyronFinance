import type { Config } from 'tailwindcss';

// Every color is a CSS variable from src/design/tokens.css, so the light theme is a variable swap and
// no component names a hex value.
const token = (name: string) => `var(--${name})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        s1: token('s1'),
        s2: token('s2'),
        line: token('line'),
        line2: token('line2'),
        tx: token('tx'),
        mu: token('mu'),
        dim: token('dim'),
        seal: token('seal'),
        ok: token('ok'),
        bad: token('bad'),
        warn: token('warn'),
        sealbg: token('sealbg'),
        okbg: token('okbg'),
        badbg: token('badbg'),
        warnbg: token('warnbg'),
        btn: token('btn'),
        btntx: token('btntx'),
        scrim: token('scrim'),
      },
      fontFamily: {
        display: ['"Archivo Variable"', 'Archivo', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      // The type scale: 44/30/26/22/19/15/14/13.5/12.5/10.5.
      fontSize: {
        44: ['44px', { lineHeight: '1.08', letterSpacing: '-0.015em' }],
        30: ['30px', { lineHeight: '1.15', letterSpacing: '-0.015em' }],
        26: ['26px', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        22: ['22px', { lineHeight: '1.2' }],
        19: ['19px', { lineHeight: '1.25' }],
        15: ['15px', { lineHeight: '1.4' }],
        14: ['14px', { lineHeight: '1.5' }],
        '13.5': ['13.5px', { lineHeight: '1.45' }],
        '12.5': ['12.5px', { lineHeight: '1.45' }],
        '10.5': ['10.5px', { lineHeight: '1.2' }],
      },
      borderRadius: {
        card: '12px',
        btn: '9px',
        'btn-sm': '7px',
        input: '10px',
        chip: '5px',
      },
      height: {
        control: '44px',
        'control-sm': '34px',
      },
      minHeight: {
        control: '44px',
        'control-sm': '34px',
      },
      maxWidth: {
        content: '1280px',
      },
      spacing: {
        gutter: '40px',
      },
      transitionDuration: {
        hover: '120ms',
        enter: '220ms',
        state: '260ms',
      },
    },
  },
  plugins: [],
} satisfies Config;
