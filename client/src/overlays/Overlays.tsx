import { useEffect } from 'react';
import { useOverlays } from '../state/overlays';
import { anyModalOpen } from '../design/primitives';
import { ConnectWalletDialog } from './ConnectWallet';
import { WalletReadinessDialog } from './WalletReadiness';
import { TransactionTrayDrawer } from './TransactionTray';
import { RelaysDialog } from './Relays';
import { SubmitFraudProofDialog } from './SubmitFraudProof';
import { AttachDisclosureNoteDialog } from './AttachDisclosureNote';

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Every global overlay, mounted once in the shell. None changes the URL. */
export function Overlays() {
  const { open, readiness, target, show, close } = useOverlays();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 't' && e.key !== 'T') return;
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (open === 'tray') return; // Esc closes it
      if (anyModalOpen()) return;
      e.preventDefault();
      show('tray');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, show]);

  return (
    <>
      <ConnectWalletDialog open={open === 'connect'} onClose={close} />
      <WalletReadinessDialog open={open === 'readiness'} onClose={close} params={readiness} />
      <TransactionTrayDrawer open={open === 'tray'} onClose={close} />
      <RelaysDialog open={open === 'relays'} onClose={close} />
      <SubmitFraudProofDialog open={open === 'fraud-proof'} onClose={close} quoteId={target?.quoteId} reveal={target?.reveal} />
      <AttachDisclosureNoteDialog open={open === 'disclosure'} onClose={close} quoteId={target?.quoteId} />
    </>
  );
}
