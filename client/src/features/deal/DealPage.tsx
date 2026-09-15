import { useState } from 'react';
import { Server, MousePointer2, Check, TriangleAlert, Radio } from 'lucide-react';
import { ButtonLink, Card, Chip } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { maxNotionalForBond, minBondForNotional, BOND_WITHDRAW_DELAY_SECS, MAX_QUOTE_VALIDITY_SECS, PROOF_GRACE_PERIOD_SECS } from '../../lib/bond';
import { splitSlash } from '../../lib/slash';
import { isAmountInput, parseUnits } from '../../lib/format';
import { formatDuration } from '../../lib/time';
import { fmtBase } from '../shared/protocol';

function Code({ children, label }: { children: string; label: string }) {
  return (
    <pre aria-label={label} className="overflow-x-auto rounded-input border border-line2 bg-bg px-4 py-3.5 font-mono text-12.5 leading-[1.75] text-tx">
      <code>{children}</code>
    </pre>
  );
}

export default function DealPage() {
  const { network } = useData();
  const symbol = network.pairs[0]?.base.symbol ?? 'tNIGHT';
  const [largest, setLargest] = useState('5000');

  let notional: bigint | undefined;
  let inputError: string | undefined;
  try {
    notional = largest ? parseUnits(largest, 6) : undefined;
    if (notional === 0n) {
      notional = undefined;
      inputError = 'Enter a size above zero.';
    }
  } catch (err) {
    inputError = (err as Error).message;
  }
  const minBond = notional ? minBondForNotional(notional) : undefined;
  const split = minBond ? splitSlash(minBond) : undefined;

  return (
    <div className="flex flex-col gap-9 max-w-[1160px] pt-2 md:pt-6">
      <div className="flex flex-col gap-3 max-w-[760px]">
        <span className="label">Become a dealer</span>
        <h1 className="font-display font-bold text-30 md:text-[42px] leading-[1.1]">Quote with a bond, not a sign-up.</h1>
        <p className="text-mu text-[17px]">Generate a key, post a bond, start answering requests. The only thing the chain ever learns about you is one commitment hash.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card id="dealer-node" className="flex flex-col gap-3.5 border-tx scroll-mt-24">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2.5 font-display font-semibold text-19">
              <Server size={20} strokeWidth={1.7} aria-hidden="true" />
              Run a Dealer Node
            </h2>
            <Chip tone="ok">Recommended</Chip>
          </div>
          <p className="text-mu">Standing quotes on both sides, offers refreshed before they expire, a crash-safe journal. Runs unattended on your machine.</p>
          <Code label="Dealer Node commands">{`cd packages/dealer-node
pnpm gen-key --config dealer.toml
pnpm bond --config dealer.toml --amount ${minBond ?? '<bond in base units>'}
pnpm start --config dealer.toml`}</Code>
          <p className="text-12.5 text-mu">
            <code className="font-mono">--amount</code> is in {symbol} base units (1 {symbol} = 1,000,000).
            {minBond !== undefined && ` ${minBond.toString()} base units = ${fmtBase(minBond)} ${symbol}, from the calculator below.`} Full steps, including funding, inventory shape and timings: <code className="font-mono">packages/dealer-node/README.md</code>.
          </p>
          <p className="text-13.5 text-mu mt-auto">Operator work takes minutes. A new wallet’s first sync takes about 30 minutes on Preprod.</p>
        </Card>

        <Card className="flex flex-col gap-3.5">
          <h2 className="flex items-center gap-2.5 font-display font-semibold text-19">
            <MousePointer2 size={20} strokeWidth={1.7} aria-hidden="true" />
            Quote in the browser
          </h2>
          <p className="text-mu">Answer requests by hand from the Desk. Good for low volume or for learning the flow.</p>
          <ul className="flex flex-col gap-2 text-13.5">
            <li className="flex gap-2.5">
              <Check size={15} className="text-ok shrink-0 mt-0.5" aria-hidden="true" />
              <span>No server and no config file</span>
            </li>
            <li className="flex gap-2.5">
              <TriangleAlert size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
              <span>You come back to record settlements and release expired quotes; nothing does it for you</span>
            </li>
            <li className="flex gap-2.5">
              <TriangleAlert size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
              <span>Your dealer key lives in this browser, encrypted. Lose the browser data and the backup, and the bond can’t be withdrawn</span>
            </li>
            <li className="flex gap-2.5">
              <TriangleAlert size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
              <span>Contract calls from the browser are not yet verified on Preprod</span>
            </li>
          </ul>
          <div className="flex justify-end mt-auto">
            <ButtonLink to="/desk?tab=keys" size="sm">
              Set up in the browser
            </ButtonLink>
          </div>
        </Card>
      </div>

      <Card className="grid grid-cols-1 gap-9 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-3.5">
          <h2 className="font-display font-semibold text-19">Size your bond</h2>
          <label className="flex flex-col gap-1.5 rounded-input border border-line bg-bg px-4 py-3.5 focus-within:border-mu">
            <span className="label">Largest quote you want to give</span>
            <span className="flex items-center justify-between gap-3">
              <input
                inputMode="decimal"
                value={largest}
                onChange={(e) => {
                  if (isAmountInput(e.target.value, 6)) setLargest(e.target.value);
                }}
                aria-invalid={Boolean(inputError)}
                aria-describedby="bond-help"
                className="w-full bg-transparent outline-none font-display font-semibold text-26 tabular-nums"
              />
              <span className="text-mu">{symbol}</span>
            </span>
          </label>
          <div className="flex items-center justify-between rounded-input bg-bg px-4 py-3.5" aria-live="polite">
            <span className="text-mu">Minimum bond</span>
            <span className="font-display font-semibold text-22 tabular-nums">{minBond === undefined ? '—' : `${fmtBase(minBond)} ${symbol}`}</span>
          </div>
          <p id="bond-help" className="text-12.5 text-mu">
            {inputError ?? `Each quote can be at most 20× your bond${minBond ? ` (this bond backs quotes up to ${fmtBase(maxNotionalForBond(minBond))} ${symbol})` : ''}. The cap applies per quote, not across all of them.`}
          </p>
        </div>

        <div className="flex flex-col gap-3.5">
          <h2 className="font-display font-semibold text-19">What you’re agreeing to</h2>
          <p className="text-13.5 text-mu">If a price you send doesn’t open its seal, anyone can submit the proof and the whole bond is slashed:</p>
          <div className="flex h-3 rounded-full overflow-hidden gap-0.5" aria-hidden="true">
            <span className="bg-ok" style={{ flex: 60 }} />
            <span className="bg-seal" style={{ flex: 10 }} />
            <span className="bg-line" style={{ flex: 30 }} />
          </div>
          {split ? (
            <ul className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-12.5" aria-label="How a slashed bond is split">
              <li>
                <span className="text-ok">60 %</span> {fmtBase(split.taker)} {symbol} to the taker
              </li>
              <li>
                <span className="text-seal">10 %</span> {fmtBase(split.prover)} to whoever proves it
              </li>
              <li>
                <span className="text-mu">30 %</span> {fmtBase(split.burned)} burned
              </li>
            </ul>
          ) : (
            <p className="text-12.5 text-mu">Enter a size to see the split in your numbers.</p>
          )}
          <p className="text-12.5 text-mu">A taker who proves the fraud themselves receives 70 %. You are deactivated, and the slash stays on your record for good.</p>
          <div className="h-px bg-line2" />
          <dl className="flex flex-col gap-2 text-13.5">
            <div className="flex justify-between gap-4">
              <dt className="text-mu">Quotes stay binding</dt>
              <dd>up to {formatDuration(MAX_QUOTE_VALIDITY_SECS)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-mu">Expired quotes can be released after</dt>
              <dd>a {formatDuration(PROOF_GRACE_PERIOD_SECS)} proof window</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-mu">Withdrawal waits</dt>
              <dd>{BOND_WITHDRAW_DELAY_SECS / 3600} h, with no live quotes</dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card className="flex flex-col gap-3" aria-labelledby="coins-title">
        <h2 id="coins-title" className="flex items-center gap-2.5 font-display font-semibold text-15">
          <TriangleAlert size={17} className="text-warn" aria-hidden="true" />
          Shape your coins before you quote
        </h2>
        <p className="text-13.5 text-mu max-w-[80ch]">
          Wallets spend the smallest coins first, and every coin swept into an offer makes the settlement heavier. On Preprod, settlements with more than one unshielded input per side were rejected by the node’s time-to-dismiss rule
          (Custom error 168). But an offer also holds a whole coin until it expires, so one coin per asset allows only one live quote per side. Merge small coins first, then let the node split towards <code className="font-mono">ladder_coins</code>{' '}
          coins that can each back a rung, and keep <code className="font-mono">max_live_quotes</code> at or below it.
        </p>
      </Card>

      <Card id="run-a-relay" className="flex flex-col gap-3 scroll-mt-24">
        <h2 className="flex items-center gap-2.5 font-display font-semibold text-15">
          <Radio size={17} aria-hidden="true" />
          Run a relay
        </h2>
        <p className="text-13.5 text-mu max-w-[80ch]">
          Relays hold no funds and no privileged role; they pass RFQs and seal references, and can hold encrypted reveals they can’t read. Dealers usually run one. The wire format is public (<code className="font-mono">docs/RELAY.md</code>), so
          any conforming node works.
        </p>
        <Code label="Relay command">{'RELAY_PORT=18787 RELAY_ENABLE_MAILBOX=true RELAY_PEERS=ws://<another relay>/gossip pnpm --filter @otc/relay-node start'}</Code>
      </Card>
    </div>
  );
}
