import { Check, CircleAlert, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Banner, Button, Dialog, Hash } from '../design/primitives';
import { cx } from '../design/cx';
import { useReadiness, type CheckState, type ReadinessCheck } from '../data/useReadiness';
import { useWallet } from '../data/useWallet';
import { useOverlays, type ReadinessParams } from '../state/overlays';

const ICON: Record<CheckState, { node: JSX.Element; className: string; word: string }> = {
  ok: { node: <Check size={15} strokeWidth={2} />, className: 'text-ok', word: 'Ready' },
  warn: { node: <TriangleAlert size={15} strokeWidth={1.7} />, className: 'text-warn', word: 'Caution' },
  bad: { node: <CircleAlert size={15} strokeWidth={1.7} />, className: 'text-bad', word: 'Not ready' },
  checking: { node: <LoaderCircle size={15} strokeWidth={1.7} />, className: 'text-mu', word: 'Checking' },
  info: { node: <Info size={15} strokeWidth={1.7} />, className: 'text-mu', word: 'Note' },
};

export function ReadinessRows({ checks, compact }: { checks: ReadinessCheck[]; compact?: boolean }) {
  return (
    <ul className="flex flex-col gap-2.5" aria-label="Wallet readiness">
      {checks
        .filter((c) => !compact || c.id !== 'coins')
        .map((c) => (
          <li key={c.id} className="flex gap-2.5 text-13.5">
            <span aria-hidden="true" className={cx('mt-0.5 shrink-0', ICON[c.state].className)}>
              {ICON[c.state].node}
            </span>
            <span className="min-w-0">
              <span className="sr-only">{ICON[c.state].word}: </span>
              <span>{c.label}</span>
              {c.detail && <span className="block text-12.5 text-mu">{c.detail}</span>}
            </span>
          </li>
        ))}
    </ul>
  );
}

export function WalletReadinessDialog({ open, onClose, params }: { open: boolean; onClose(): void; params: ReadinessParams }) {
  const { checks, refresh } = useReadiness(params);
  const { status, address, info, disconnect, indexerNotice } = useWallet();
  const show = useOverlays((s) => s.show);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Wallet readiness"
      size="sm"
      footer={
        status === 'connected' ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>
              Check again
            </Button>
            <Button
              size="sm"
              onClick={() => {
                disconnect();
                onClose();
              }}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={() => show('connect')}>
            Connect a wallet
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {status === 'connected' && address && (
          <div className="flex flex-col gap-1">
            <span className="label">{info?.name ?? 'Wallet'}</span>
            <Hash value={address} label="wallet address" full className="text-mu" />
          </div>
        )}
        {indexerNotice && (
          <Banner tone="warn" title="Your wallet uses a different indexer">
            This app now reads the chain through your wallet’s indexer (<span className="font-mono text-12.5 break-all">{indexerNotice.wallet}</span>) instead of its default (
            <span className="font-mono text-12.5 break-all">{indexerNotice.app}</span>).
          </Banner>
        )}
        <ReadinessRows checks={checks} />
      </div>
    </Dialog>
  );
}
