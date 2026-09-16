import { Bell, CircleAlert, Radio, Timer, Wallet } from 'lucide-react';
import { Button, Pill } from '../design/primitives';
import { cx } from '../design/cx';
import { useRelays } from '../data/useRelays';
import { useWallet } from '../data/useWallet';
import { useOverlays } from '../state/overlays';
import { useTray } from '../state/tray';
import { needsYou, useNotifications } from '../state/notifications';

/** Relay count: red at 0, amber at 1, plain at 2 or more. Always visible. */
export function RelaysPill({ count, socketsOpen, onClick }: { count: number; socketsOpen: boolean; onClick(): void }) {
  const tone = count === 0 ? 'text-bad border-bad' : count === 1 ? 'text-warn border-warn' : '';
  const word = socketsOpen ? 'connected' : 'reachable';
  return (
    <Pill onClick={onClick} className={cx(tone)} aria-haspopup="dialog" aria-label={`${count} relay${count === 1 ? '' : 's'} ${word}${count < 2 ? ', requests need at least 2' : ''}. Manage relays`}>
      <Radio size={15} strokeWidth={1.7} aria-hidden="true" />
      <b className={cx('font-medium', count >= 2 && 'text-tx')}>{count}</b>
      <span className="hidden md:inline">{count === 1 ? 'relay' : 'relays'}</span>
      {count < 2 && <CircleAlert size={14} strokeWidth={2} className="text-bad" aria-hidden="true" />}
    </Pill>
  );
}

/** The notification centre's entry point. Says in words what is waiting: in progress first, then what
 *  needs the user, then unread updates. */
export function NotificationsPill({ running, pending, unread, onClick }: { running: number; pending: number; unread: number; onClick(): void }) {
  const [count, word, tone] = running ? [running, 'in progress', 'text-seal'] : pending ? [pending, pending === 1 ? 'needs you' : 'need you', 'text-warn border-warn'] : unread ? [unread, 'new', ''] : [0, '', ''];
  const label = `Notifications: ${running} in progress, ${pending} ${pending === 1 ? 'needs' : 'need'} you, ${unread} unread. Open (N)`;
  return (
    <Pill onClick={onClick} aria-haspopup="dialog" aria-label={label} className={cx(tone)}>
      {running ? <Timer size={15} strokeWidth={1.7} aria-hidden="true" /> : <Bell size={15} strokeWidth={1.7} aria-hidden="true" />}
      {count > 0 && <b className="font-medium">{count}</b>}
      {count > 0 && <span className="hidden md:inline">{word}</span>}
    </Pill>
  );
}

function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 7)}…${address.slice(-4)}` : address;
}

export function TopBarActions() {
  const relays = useRelays();
  const { status, address } = useWallet();
  const show = useOverlays((s) => s.show);
  const running = useTray((s) => s.entries.filter((e) => e.status === 'running').length);
  const notices = useNotifications((s) => s.entries);
  const pending = needsYou(notices).length;
  const unread = notices.filter((n) => !n.read).length;

  return (
    <>
      <RelaysPill count={relays.count} socketsOpen={relays.socketsOpen} onClick={() => show('relays')} />
      <NotificationsPill running={running} pending={pending} unread={unread} onClick={() => show('notifications')} />

      {status === 'connected' && address ? (
        <Pill onClick={() => show('readiness')} aria-haspopup="dialog" aria-label={`Wallet ${address}. Wallet readiness`}>
          <Wallet size={15} strokeWidth={1.7} aria-hidden="true" />
          <b className="font-mono font-medium text-12.5 text-tx">{shortAddress(address)}</b>
        </Pill>
      ) : status === 'lost' ? (
        <Pill onClick={() => show('connect')} className="text-warn border-warn" aria-haspopup="dialog">
          <Wallet size={15} strokeWidth={1.7} aria-hidden="true" />
          Reconnect
        </Pill>
      ) : (
        <Button size="sm" variant="primary" onClick={() => show('connect')} busy={status === 'connecting'} aria-haspopup="dialog">
          <Wallet size={15} strokeWidth={1.7} aria-hidden="true" />
          <span className="hidden sm:inline">{status === 'connecting' ? 'Connecting…' : 'Connect wallet'}</span>
          <span className="sm:hidden">{status === 'connecting' ? '…' : 'Connect'}</span>
        </Button>
      )}
    </>
  );
}
