// Submit a Class A fraud proof: a dealer-signed reveal that does not open the dealer's on-chain seal
// (docs/CONTRACTS.md §5.3). Anyone holding such a reveal may submit it. The connected wallet is both
// the wronged taker (beneficiary, 60 %) and the prover (10 %), so it receives 70 %; 30 % is burned.
//
// Before anything is sent, the reveal is checked here against the chain exactly as the circuit will
// check it: the signature must verify under the dealer's on-chain quote key and the terms must NOT
// open the commitment. A proof the circuit would refuse is never submitted.

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Banner, Button, Dialog, Hash, Skeleton } from '../design/primitives';
import { useData } from '../data/DataProvider';
import { runCircuit, type CircuitOutcome } from '../data/useCircuit';
import { useWalletStore } from '../state/wallet';
import { useOverlays, type FraudReveal } from '../state/overlays';
import { useRfq } from '../state/rfq';
import { splitSlash } from '../lib/slash';
import { messageOf } from '../lib/errors';
import { fmtBase } from '../features/shared/protocol';

type Check =
  | { state: 'checking' }
  | { state: 'ready'; bond: bigint; slashedBefore: bigint }
  | { state: 'refused'; reason: string };

export function SubmitFraudProofDialog({ open, onClose, quoteId, reveal: given }: { open: boolean; onClose(): void; quoteId?: string; reveal?: FraudReveal }) {
  const ports = useData();
  const walletStatus = useWalletStore((s) => s.status);
  const show = useOverlays((s) => s.show);
  const record = useRfq((s) => (quoteId ? s.state.quotes[quoteId] : undefined));
  const [check, setCheck] = useState<Check>({ state: 'checking' });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CircuitOutcome>();

  const reveal: FraudReveal | undefined =
    given ??
    (record?.terms && record.nonce && (record.signature ?? record.message?.sig)
      ? { dealerCmt: record.dealerCmt, terms: record.terms, nonce: record.nonce, signature: (record.signature ?? record.message?.sig)! }
      : undefined);
  const base = ports.network.pairs[0]?.base.symbol ?? 'tNIGHT';

  useEffect(() => {
    if (!open || !quoteId || !reveal) return;
    let alive = true;
    setOutcome(undefined);
    setCheck({ state: 'checking' });
    (async () => {
      const sdk = await import('@otc/sdk/browser');
      const quote = await ports.chain.quote(quoteId);
      if (!quote) return { state: 'refused', reason: 'No quote with this id on-chain.' } as Check;
      if (quote.dealerCmt !== reveal.dealerCmt) return { state: 'refused', reason: 'This reveal names a different dealer than the quote on-chain.' } as Check;
      if (quote.resolved) return { state: 'refused', reason: 'This quote is already resolved on-chain (settled, released or already slashed). A fraud proof can no longer be submitted.' } as Check;
      const dealer = await ports.chain.dealer(quote.dealerCmt);
      if (!dealer.bond || dealer.bond.amount === 0n) return { state: 'refused', reason: 'The dealer has no bond left to slash.' } as Check;
      const verdict = sdk.verifyReveal(
        {
          terms: reveal.terms,
          encodedTerms: sdk.encodeTerms(reveal.terms),
          nonce: sdk.hexToBytes(reveal.nonce),
          signature: sdk.decodeSchnorrSignature(reveal.signature),
          offerFile: '',
          expiresAt: Number.MAX_SAFE_INTEGER,
        },
        sdk.hexToBytes(quote.commitment),
        dealer.bond.quotePk,
      );
      if (verdict.valid) return { state: 'refused', reason: 'This reveal opens its seal. There is no fraud to prove.' } as Check;
      if (verdict.reason !== 'reveal does not open the on-chain commitment') {
        return { state: 'refused', reason: `The contract would refuse this proof: ${verdict.reason}.` } as Check;
      }
      return { state: 'ready', bond: dealer.bond.amount, slashedBefore: dealer.slashed } as Check;
    })()
      .catch((err): Check => ({ state: 'refused', reason: `Couldn’t check the reveal against the chain: ${messageOf(err)}` }))
      .then((c) => {
        if (alive) setCheck(c);
      });
    return () => {
      alive = false;
    };
    // reveal is derived from stable store values; re-check when the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quoteId, reveal?.signature, ports.chain]);

  async function submit() {
    if (!quoteId || !reveal || check.state !== 'ready') return;
    setBusy(true);
    try {
      const sdk = await import('@otc/sdk/browser');
      const address = await ports.wallet.address();
      const beneficiary = sdk.hexToBytes(sdk.midnightKeyToHex(address, 'addr'));
      const slashedBefore = check.slashedBefore;
      const out = await runCircuit(
        ports,
        {
          circuit: 'submitFraudProofMismatch',
          args: [sdk.hexToBytes(quoteId), sdk.encodeTerms(reveal.terms), sdk.hexToBytes(reveal.nonce), sdk.decodeSchnorrSignature(reveal.signature), beneficiary],
          takerAddress: beneficiary,
        },
        {
          title: `Fraud proof against ${reveal.dealerCmt.slice(0, 8)}…`,
          kind: 'fraud-proof',
          href: `/dealers/${reveal.dealerCmt}`,
          landed: async () => (await ports.chain.dealer(reveal.dealerCmt)).slashed > slashedBefore,
        },
      );
      setOutcome(out);
    } catch (err) {
      setOutcome({ ok: false, trayId: '', error: messageOf(err) });
    } finally {
      setBusy(false);
    }
  }

  const split = check.state === 'ready' ? splitSlash(check.bond) : undefined;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Submit fraud proof"
      description="The dealer signed a price that doesn’t open the seal they committed on-chain. Proving it slashes their whole bond."
      footer={
        outcome?.ok ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {walletStatus === 'connected' ? (
              <Button variant="danger" onClick={() => void submit()} disabled={check.state !== 'ready' || busy} busy={busy}>
                {busy ? 'Submitting proof…' : split ? `Slash bond · receive ${fmtBase(split.selfProving)} ${base}` : 'Slash bond'}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => show('connect')}>
                Connect wallet
              </Button>
            )}
          </>
        )
      }
    >
      {!quoteId || !reveal ? (
        <Banner tone="warn" title="No signed reveal to prove with">
          A fraud proof needs the dealer’s signed reveal. It is kept in the tab that received it, or in saved evidence you can load on Verify.
        </Banner>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 text-13.5">
            <span>
              Quote <Hash value={quoteId} label="quote" />
            </span>
            <span>
              Dealer <Hash value={reveal.dealerCmt} label="dealer" />
            </span>
          </div>

          {check.state === 'checking' && (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Checking the reveal against the chain">
              <Skeleton height={16} />
              <Skeleton height={16} width="70%" />
            </div>
          )}
          {check.state === 'refused' && (
            <Banner tone="warn" title="Nothing to submit">
              {check.reason}
            </Banner>
          )}
          {split && (
            <>
              <ul className="flex flex-col gap-1.5 text-13.5" aria-label="Checks">
                <li>✓ Signed by the dealer’s on-chain quote key</li>
                <li>✓ Does not open the on-chain seal</li>
                <li>✓ Quote still unresolved</li>
              </ul>
              <div className="rounded-input border border-line2 divide-y divide-line2 text-13.5" role="table" aria-label="What the slash pays">
                {[
                  { label: 'To you as the wronged taker', amount: split.taker, pct: '60 %' },
                  { label: 'To you as the prover', amount: split.prover, pct: '10 %' },
                  { label: 'Burned', amount: split.burned, pct: '30 %' },
                ].map((row) => (
                  <div key={row.label} role="row" className="flex items-center justify-between gap-3 px-3.5 py-2">
                    <span role="cell" className="text-mu">
                      {row.label} · {row.pct}
                    </span>
                    <span role="cell" className="tabular-nums">
                      {fmtBase(row.amount)} {base}
                    </span>
                  </div>
                ))}
                <div role="row" className="flex items-center justify-between gap-3 px-3.5 py-2 font-medium">
                  <span role="cell">You receive</span>
                  <span role="cell" className="tabular-nums">
                    {fmtBase(split.selfProving)} {base}
                  </span>
                </div>
              </div>
              <p className="text-12.5 text-mu">
                The dealer is deactivated. Your wallet proves the largest circuit in the protocol, which can take a while, then pays the fee. Every stage shows in the transaction tray.
              </p>
            </>
          )}
          {outcome && !outcome.ok && (
            <Banner tone="bad" title="The proof wasn’t accepted">
              {outcome.error}
            </Banner>
          )}
          {outcome?.ok && (
            <Banner tone="ok" title="Bond slashed" icon={<ShieldAlert size={16} aria-hidden="true" />}>
              {outcome.note ?? `Confirmed in block ${outcome.result?.blockHeight}. The slash is on the dealer’s public record.`}
            </Banner>
          )}
        </div>
      )}
    </Dialog>
  );
}
