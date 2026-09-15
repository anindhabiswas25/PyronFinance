import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Banner, Button, ErrorState } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { useOverlays } from '../../state/overlays';
import { parseRevealInput } from '../../lib/verify-input';
import { messageOf } from '../../lib/errors';
import { splitSlash } from '../../lib/slash';
import { fmtBase } from '../shared/protocol';
import { checkReveal, type RevealReport } from './checks';
import { Checklist, JsonInput } from './parts';

export default function CheckQuote() {
  const ports = useData();
  const showFor = useOverlays((s) => s.showFor);
  const [text, setText] = useState('');
  const [inputError, setInputError] = useState<string>();
  const [chainError, setChainError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<RevealReport & { quoteId: string; reveal: ReturnType<typeof parseRevealInput> }>();
  const base = ports.network.pairs[0]?.base.symbol ?? 'tNIGHT';

  async function run() {
    const parsed = parseRevealInput(text);
    setReport(undefined);
    setChainError(undefined);
    if (!parsed.ok) return setInputError(parsed.error);
    setInputError(undefined);
    setBusy(true);
    try {
      const r = await checkReveal(ports.chain, parsed.value, Math.floor(ports.clock.nowMs() / 1000));
      setReport({ ...r, quoteId: parsed.value.quoteId, reveal: parsed });
    } catch (err) {
      setChainError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const v = report?.verdict;
  const parsedReveal = report?.reveal.ok ? report.reveal.value : undefined;

  return (
    <div className="flex flex-col gap-4 pt-4">
      <JsonInput
        id="verify-reveal"
        label="Signed reveal or saved evidence"
        value={text}
        onChange={setText}
        placeholder={'{ "quoteId": "…", "dealerCmt": "…", "terms": { "pair", "side", "price", "size" }, "nonce": "…", "signature": "…" }'}
      />
      {inputError && <p className="text-13.5 text-bad">{inputError}</p>}
      <div>
        <Button variant="primary" onClick={() => void run()} disabled={!text.trim() || busy} busy={busy}>
          {busy ? 'Checking against the chain…' : 'Check'}
        </Button>
      </div>

      {chainError && (
        <ErrorState compact title="Can’t reach the chain — nothing was checked" actions={<Button size="sm" onClick={() => void run()}>Try again</Button>}>
          {chainError}
        </ErrorState>
      )}

      {report && (
        <div className="flex flex-col gap-3" aria-live="polite">
          {v?.kind === 'fraud' && parsedReveal && (
            <Banner
              tone="bad"
              urgent
              icon={<ShieldAlert size={17} aria-hidden="true" />}
              title="Provable fraud: the dealer signed a price that doesn’t open their seal."
              actions={
                <Button size="sm" variant="danger" onClick={() => showFor('fraud-proof', { quoteId: parsedReveal.quoteId, reveal: parsedReveal.reveal })}>
                  Submit proof · up to {fmtBase(splitSlash(v.bond).selfProving)} {base}
                </Button>
              }
            >
              Anyone holding this reveal can slash the dealer’s {fmtBase(v.bond)} {base} bond: 60 % to the wronged taker, 10 % to the prover, 30 % burned.
            </Banner>
          )}
          {v?.kind === 'fraud-resolved' && (
            <Banner tone="warn" title="This was fraud, but the quote is already resolved">
              The signed price doesn’t open the seal. The quote has since been settled, released or slashed, so the contract no longer accepts a proof for it.
            </Banner>
          )}
          {v?.kind === 'honest' && (
            <Banner tone="ok" title="The dealer’s signed price opens their seal">
              {parsedReveal?.kind === 'evidence'
                ? 'This is not fraud. If the settlement failed, the checks below show whether the offer’s coins were spent elsewhere; that is recorded against the dealer, not slashed.'
                : 'The dealer revealed exactly the price they sealed.'}
            </Banner>
          )}
          {v?.kind === 'not-signed' && (
            <Banner tone="warn" title="Not signed by this dealer">
              The signature doesn’t verify under the dealer’s on-chain quote key, so this file proves nothing about what the dealer said.
            </Banner>
          )}
          {v?.kind === 'unknown-quote' && (
            <Banner tone="warn" title={`No such quote on ${ports.network.label}`}>
              Check the network in the top bar.
            </Banner>
          )}
          <Checklist label="Checks" rows={report.rows} />
        </div>
      )}
    </div>
  );
}
