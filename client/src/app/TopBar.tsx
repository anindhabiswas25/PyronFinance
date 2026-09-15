import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, Monitor, Moon, Sun } from 'lucide-react';
import { cx } from '../design/cx';
import { Dialog, Drawer, Pill } from '../design/primitives';
import { NEXT_THEME, THEME_LABEL } from '../design/theme';
import { usePrefs } from '../state/prefs';
import { useNetwork } from '../state/network';
import { NETWORKS, type NetworkId } from '../config/networks';

export const NAV = [
  { to: '/trade', label: 'Trade' },
  { to: '/activity', label: 'Activity' },
  { to: '/dealers', label: 'Dealers' },
  { to: '/desk', label: 'Desk' },
  { to: '/verify', label: 'Verify' },
] as const;

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="10" style={{ fill: 'var(--seal)' }} />
      <path d="M2 12h7.2M14.8 12H22" style={{ stroke: 'var(--bg)' }} strokeWidth="2" />
      <circle cx="12" cy="12" r="2.6" fill="none" style={{ stroke: 'var(--bg)' }} strokeWidth="2" />
    </svg>
  );
}

function NavItems({ onNavigate, vertical }: { onNavigate?: () => void; vertical?: boolean }) {
  return (
    <>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'rounded-[6px] font-medium transition-colors duration-hover',
              vertical ? 'px-3 py-2.5 text-15' : 'px-3 py-[7px]',
              isActive ? 'text-tx bg-s2' : 'text-mu hover:text-tx',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

function ThemeButton() {
  const { theme, setTheme } = usePrefs();
  const icon: Record<typeof theme, ReactNode> = {
    system: <Monitor size={16} strokeWidth={1.7} aria-hidden="true" />,
    dark: <Moon size={16} strokeWidth={1.7} aria-hidden="true" />,
    light: <Sun size={16} strokeWidth={1.7} aria-hidden="true" />,
  };
  return (
    <Pill onClick={() => setTheme(NEXT_THEME[theme])} aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[NEXT_THEME[theme]]}`} title={`Theme: ${THEME_LABEL[theme]}`}>
      {icon[theme]}
      <span className="hidden xl:inline">{THEME_LABEL[theme]}</span>
    </Pill>
  );
}

function NetworkPill() {
  const { network, setNetwork } = useNetwork();
  const [open, setOpen] = useState(false);
  const cfg = NETWORKS[network];
  return (
    <>
      <Pill onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Network: ${cfg.label}. Change network`}>
        <span aria-hidden="true" className="w-[7px] h-[7px] rounded-full bg-ok" />
        <b className="font-medium text-tx">{cfg.label}</b>
      </Pill>
      <Dialog open={open} onClose={() => setOpen(false)} title="Network" description="Switching network changes which contract, indexer and relays every page reads." size="sm">
        <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Network">
          {(Object.keys(NETWORKS) as NetworkId[]).map((id) => {
            const n = NETWORKS[id];
            const on = id === network;
            return (
              <li key={id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!n.selectable}
                  onClick={() => {
                    setNetwork(id);
                    setOpen(false);
                  }}
                  className={cx(
                    'w-full text-left rounded-input border px-4 py-3 transition-colors duration-hover',
                    on ? 'border-tx bg-s2' : 'border-line hover:border-mu',
                    !n.selectable && 'opacity-70 cursor-not-allowed hover:border-line',
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-medium">{n.label}</span>
                    <span className="text-12.5 text-mu">{on ? 'Selected' : n.selectable ? n.pairs.map((p) => p.code).join(', ') : 'Not available'}</span>
                  </span>
                  {n.unavailableReason && <span className="block text-12.5 text-mu mt-1">{n.unavailableReason}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>
    </>
  );
}

export function TopBar({ right }: { right?: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 bg-bg border-b border-line2">
      <div className="h-[60px] flex items-center gap-4 lg:gap-7 px-4 md:px-8">
        <Link to="/" className="flex items-center gap-2.5 font-display font-bold text-[17px] tracking-[-0.01em] text-tx" aria-label="Pyron, home">
          <Logo />
          <span>Pyron</span>
        </Link>
        <nav aria-label="Primary" className="hidden lg:flex gap-0.5">
          <NavItems />
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:contents">
            <NetworkPill />
          </span>
          {right}
          <span className="hidden sm:contents">
            <ThemeButton />
          </span>
          <button
            type="button"
            className="lg:hidden grid place-items-center w-control-sm h-control-sm rounded-btn-sm border border-line text-mu hover:text-tx"
            aria-label="Open menu"
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={18} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      </div>
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" width={320}>
        <nav aria-label="Primary" className="flex flex-col gap-1">
          <NavItems vertical onNavigate={() => setMenuOpen(false)} />
        </nav>
        <div className="flex flex-wrap gap-2 mt-6 sm:hidden">
          <NetworkPill />
          <ThemeButton />
        </div>
      </Drawer>
    </header>
  );
}
