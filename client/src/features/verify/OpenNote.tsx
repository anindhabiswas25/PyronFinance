import { useEffect, useState } from 'react';
import { Banner, Button, ErrorState } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { parseNoteInput } from '../../lib/verify-input';
import { hexToBytes, isHex32, normalizeHex } from '../../lib/hex';
import { messageOf } from '../../lib/errors';
import { formatUtc } from '../../lib/time';
import { checkNote, type NoteReport } from './checks';
import { Checklist, JsonInput } from './parts';

export default function OpenNote() {
  const ports = useData();
  const [text, setText] = useState('');
  const [tradeId, setTradeId] = useState('');
  const [secret, setSecret] = useState('');
  const [inputError, setInputError] = useState<string>();
  const [chainError, setChainError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<NoteReport>();

  // A note file saved by this app names its trade.
  useEffect(() => {
    const parsed = parseNoteInput(text);
    if (parsed.ok && parsed.value.tradeId && !tradeId) setTradeId(parsed.value.tradeId);
  }, [text, tradeId]);

  const tid = normalizeHex(tradeId.trim());
  const sk = normalizeHex(secret.trim());

  async function run() {
    setReport(undefined);
    setChainError(undefined);
    const parsed = parseNoteInput(text);
    if (!parsed.ok) return setInputError(parsed.error);
    if (!isHex32(tid)) return setInputError('The trade id is 64 hex characters.');
    if (!isHex32(sk)) return setInputError('Your secret key is 64 hex characters.');
    setInputError(undefined);
    setBusy(true);
    try {
      setReport(await checkNote(ports.chain, parsed.value.blob, tid, hexToBytes(sk)));
    } catch (err) {
      setChainError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const note = report?.note;

  return (
    <div className="flex flex-col gap-4 pt-4">
      <JsonInput id="verify-note" label="Disclosure note" value={text} onChange={setText} placeholder={'{ "v": 1, "epk": "…", "nonce": "…", "ct": "…" }  or a pyron-note-….json file'} rows={5} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="verify-trade" className="label">
            Trade id
          </label>
          <input
            id="verify-trade"
            value={tradeId}
            onChange={(e) => setTradeId(e.target.value)}
            placeholder="64 hex characters"
            spellCheck={false}
            className="h-control rounded-input border border-line bg-bg px-3 font-mono text-12.5 outline-none focus:border-mu"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="verify-secret" className="label">
            Your secret key
          </label>
          <input
            id="verify-secret"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="64 hex characters (X25519)"
            spellCheck={false}
            className="h-control rounded-input border border-line bg-bg px-3 font-mono text-12.5 outline-none focus:border-mu"
          />
          <span className="text-12.5 text-mu">Used only in this tab to decrypt. It is never stored or sent.</span>
        </div>
      </div>
      {inputError && <p className="text-13.5 text-bad">{inputError}</p>}
      <div>
        <Button variant="primary" onClick={() => void run()} disabled={!text.trim() || busy} busy={busy}>
          {busy ? 'Checking against the chain…' : 'Open and verify'}
        </Button>
      </div>

      {chainError && (
        <ErrorState compact title="Can’t reach the chain — the note wasn’t verified" actions={<Button size="sm" onClick={() => void run()}>Try again</Button>}>
          {chainError}
        </ErrorState>
      )}

      {report && (
        <div className="flex flex-col gap-3" aria-live="polite">
          {report.ok ? (
            <Banner tone="ok" title="Verified: this note is attached to this trade and addressed to you" />
          ) : note ? (
            <Banner tone="warn" title="The note opens, but the chain doesn’t back it">
              What it says is the sender’s claim, not evidence of a trade.
            </Banner>
          ) : (
            <Banner tone="bad" title={report.rows[0]?.detail ?? 'The note didn’t open'} />
          )}
          <Checklist label="Checks" rows={report.rows} />
          {note && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-input border border-line2 px-4 py-3 text-13.5">
              <dt className="text-mu">Pair</dt>
              <dd>{note.pair}</dd>
              <dt className="text-mu">Dealer</dt>
              <dd>
                {note.side}s {note.size} at {note.price}
              </dd>
              <dt className="text-mu">Settled</dt>
              <dd>{formatUtc(note.settledAt)}</dd>
              <dt className="text-mu">Dealer key</dt>
              <dd className="font-mono text-12.5 break-all">{note.dealerCmt}</dd>
              {Object.entries(note.parties).map(([k, val]) => (
                <div key={k} className="contents">
                  <dt className="text-mu capitalize">{k}</dt>
                  <dd>{val}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
