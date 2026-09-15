import { Radio, Timer, Wallet } from 'lucide-react';
import { Button, Pill } from '../design/primitives';
import { cx } from '../design/cx';
import { useRelays } from '../data/useRelays';
import { useWallet } from '../data/useWallet';
import { useOverlays } from '../state/overlays';
import { useTray } from '../state/tray';

/** Relay count: red at 0, amber at 1, plain at 2 or more. Always visible. */
export function RelaysPill({ count, socketsOpen, onClick }: { count: number; socketsOpen: boolean; onClick(): void }) {
  const tone = count === 0 ? 'text-bad border-bad' : count === 1 ? 'text-warn border-warn' : '';
  const word = socketsOpen ? 'connected' : 'reachable';
  return (
    <Pill onClick={onClick} className={cx(tone)} aria-haspopup="dialog" aria-label={`${count} relay${count === 1 ? '' : 's'} ${word}${count < 2 ? ', requests need at least 2' : ''}. Manage relays`}>
      <Radio size={15} strokeWidth={1.7} aria-hidden="true" />
      <b className={cx('font-medium', count >= 2 && 'text-tx')}>{count}</b>
      <span className="hidden md:inline">{count === 1 ? 'relay' : 'relays'}</span>
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
  const entries = useTray((s) => s.entries);
  const running = entries.filter((e) => e.status === 'running').length;

  return (
    <>
      <RelaysPill count={relays.count} socketsOpen={relays.socketsOpen} onClick={() => show('relays')} />
      {entries.length > 0 && (
        <Pill onClick={() => show('tray')} aria-haspopup="dialog" aria-label={`${running} in progress, ${entries.length - running} finished. Open the transaction tray (T)`} className={running ? 'text-seal' : ''}>
          <Timer size={15} strokeWidth={1.7} aria-hidden="true" />
          <b className="font-medium">{running || entries.length}</b>
          <span className="hidden md:inline">{running ? 'in progress' : 'recent'}</span>
        </Pill>
      )}
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
