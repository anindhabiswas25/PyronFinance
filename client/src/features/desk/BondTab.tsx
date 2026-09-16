import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Banner, Button, Card, EmptyState } from '../../design/primitives';
import { useData } from '../../data/DataProvider';
import { runCircuit, type CircuitOutcome } from '../../data/useCircuit';
import { NATIVE_TOKEN_RAW } from '../../config/networks';
import { isAmountInput, parseUnits } from '../../lib/format';
import { formatUtc } from '../../lib/time';
import { messageOf } from '../../lib/errors';
import { BOND_WITHDRAW_DELAY_SECS, NOTIONAL_CAP_K } from '../../lib/bond';
import { fmtBase } from '../shared/protocol';
import { bondGates, type BondAction, type Gate } from './rules';
import { useDealer } from './dealerVault';
import type { DeskView } from './DeskPage';

export function BondTab({ view }: { view: DeskView }) {
  const ports = useData();
  const identity = useDealer((s) => s.identity);
  const { snap, now, actor, dealerCmt } = view;
  const bond = dealerCmt ? snap.snapshot?.view.bonds.get(dealerCmt) : undefined;
  const gates = bondGates(bond, now, actor);
  const [postAmount, setPostAmount] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [balance, setBalance] = useState<bigint>();
  const [busy, setBusy] = useState<BondAction>();
  const [outcomes, setOutcomes] = useState<Partial<Record<BondAction, CircuitOutcome>>>({});

  useEffect(() => {
    if (!actor.walletConnected) return setBalance(undefined);
    let alive = true;
    ports.wallet
      .balances()
      .then((b) => alive && setBalance(b[NATIVE_TOKEN_RAW] ?? 0n))
      .catch(() => alive && setBalance(undefined));
    return () => {
      alive = false;
    };
  }, [actor.walletConnected, ports.wallet, outcomes]);

  if (!view.own || !identity) {
    return (
      <Card className="mt-4">
        <EmptyState title="Bond actions need your dealer key" actions={<Button variant="primary" onClick={() => view.go('keys')}>Set up or unlock your key</Button>}>
          {dealerCmt ? 'This dealer is open read-only.' : 'No dealer is open.'} Bonds are posted, topped up and withdrawn with the key they belong to.
        </EmptyState>
      </Card>
    );
  }

  const amountOf = (text: string): bigint | undefined => {
    try {
      const v = parseUnits(text, 6);
      return v > 0n ? v : undefined;
    } catch {
      return undefined;
    }
  };
  const fundsGate = (amount: bigint | undefined): Gate =>
    amount === undefined ? { ok: false, reason: 'Enter an amount above zero.' } : balance !== undefined && balance < amount ? { ok: false, reason: `Your wallet holds ${fmtBase(balance)} tNIGHT.` } : { ok: true };

  async function act(action: BondAction, amount?: bigint) {
    if (!identity) return;
    setBusy(action);
    try {
      const sdk = await import('@otc/sdk/browser');
      const secret = identity.secret;
      const before = bond;
      const read = async () => (await ports.chain.snapshot()).view.bonds.get(identity.dealerCmt);
      let out: CircuitOutcome;
      switch (action) {
        case 'post':
          out = await runCircuit(ports, { circuit: 'postBond', args: [amount!, identity.quotePk], dealerSecretKey: secret }, { title: `Post bond ${fmtBase(amount!)} tNIGHT`, kind: 'bond', landed: async () => Boolean(await read()) });
          break;
        case 'topUp':
          out = await runCircuit(ports, { circuit: 'topUpBond', args: [amount!], dealerSecretKey: secret }, { title: `Top up bond by ${fmtBase(amount!)} tNIGHT`, kind: 'bond', landed: async () => ((await read())?.amount ?? 0n) > (before?.amount ?? 0n) });
          break;
        case 'requestWithdrawal':
          out = await runCircuit(
            ports,
            // The contract bounds this to within 300 s of chain time.
            { circuit: 'requestBondWithdrawal', args: [BigInt(Math.floor(Date.now() / 1000))], dealerSecretKey: secret },
            { title: 'Request bond withdrawal', kind: 'bond', landed: async () => ((await read())?.withdrawRequested ?? 0n) > 0n },
          );
          break;
        case 'withdraw': {
          const recipient = sdk.hexToBytes(sdk.midnightKeyToHex(await ports.wallet.address(), 'addr'));
          out = await runCircuit(ports, { circuit: 'withdrawBond', args: [recipient], dealerSecretKey: secret }, { title: 'Withdraw bond', kind: 'bond', landed: async () => !(await read()) });
          break;
        }
      }
      setOutcomes((o) => ({ ...o, [action]: out }));
    } catch (err) {
      setOutcomes((o) => ({ ...o, [action]: { ok: false, trayId: '', error: messageOf(err) } }));
    } finally {
      setBusy(undefined);
      snap.retry();
    }
  }

  const requested = bond ? Number(bond.withdrawRequested) : 0;
  const postAmt = amountOf(postAmount);
  const topAmt = amountOf(topUpAmount);

  const steps: Array<{ id: BondAction; title: string; done: boolean; detail: string; gate: Gate; control?: React.ReactNode; label: string; amount?: bigint }> = [
    {
      id: 'post',
      title: 'Post a bond',
      done: Boolean(bond),
      detail: bond ? `Bond ${fmtBase(bond.amount)} tNIGHT · quotes up to ${fmtBase(bond.amount * NOTIONAL_CAP_K)} tNIGHT` : 'A bond lets you quote up to 20× its size. No approval, no minimum.',
      gate: postAmt === undefined && gates.post.ok ? fundsGate(postAmt) : gates.post.ok ? fundsGate(postAmt) : gates.post,
      control: !bond && <AmountInput id="bond-post" label="Bond amount" value={postAmount} onChange={setPostAmount} />,
      label: 'Post bond',
      amount: postAmt,
    },
    {
      id: 'topUp',
      title: 'Top up',
      done: false,
      detail: 'Adds to the bond. Nothing else changes.',
      gate: gates.topUp.ok ? fundsGate(topAmt) : gates.topUp,
      control: bond && <AmountInput id="bond-topup" label="Top-up amount" value={topUpAmount} onChange={setTopUpAmount} />,
      label: 'Top up',
      amount: topAmt,
    },
    {
      id: 'requestWithdrawal',
      title: 'Request withdrawal',
      done: requested > 0,
      detail: requested > 0 ? `Requested ${formatUtc(requested)}. New quotes are refused from then on.` : 'Stops new quotes at once and starts a 24 h timelock, so a fraud proof can still land.',
      gate: gates.requestWithdrawal,
      label: 'Request withdrawal',
    },
    {
      id: 'withdraw',
      title: 'Withdraw',
      done: false,
      detail: requested > 0 ? `Unlocks ${formatUtc(requested + BOND_WITHDRAW_DELAY_SECS)} with no live quotes. The bond goes to the connected wallet.` : 'After the timelock, with no live quotes, the bond returns to your wallet.',
      gate: gates.withdraw,
      label: 'Withdraw bond',
    },
  ];

  return (
    <ol className="flex flex-col gap-3 pt-4" aria-label="Bond lifecycle">
      {steps.map((s, i) => {
        const out = outcomes[s.id];
        return (
          <li key={s.id}>
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span aria-hidden="true" className={`grid place-items-center w-7 h-7 rounded-full text-12.5 shrink-0 ${s.done ? 'bg-okbg text-ok' : 'bg-s2 text-mu'}`}>
                    {s.done ? <Check size={14} /> : i + 1}
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-display font-semibold text-15">
                      {s.title}
                      {s.done && <span className="sr-only"> (done)</span>}
                    </h2>
                    <p className="text-13.5 text-mu">{s.detail}</p>
                  </div>
                </div>
                {s.control}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant={s.id === 'withdraw' || s.id === 'requestWithdrawal' ? 'secondary' : 'primary'} size="sm" disabled={!s.gate.ok || Boolean(busy)} busy={busy === s.id} onClick={() => void act(s.id, s.amount)}>
                  {s.label}
                </Button>
                {!s.gate.ok && <span className="text-12.5 text-mu">{s.gate.reason}</span>}
              </div>
              {out && !out.ok && (
                <Banner tone="bad" title={`${s.label} failed`}>
                  {out.error}
                </Banner>
              )}
              {out?.ok && <Banner tone="ok" title={`${s.label}: done`}>{out.note ?? (out.result ? `Block ${out.result.blockHeight}` : undefined)}</Banner>}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

function AmountInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange(v: string): void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            if (isAmountInput(e.target.value, 6)) onChange(e.target.value);
          }}
          placeholder="0"
          className="h-control-sm w-[160px] rounded-btn-sm border border-line bg-bg px-3 tabular-nums outline-none focus:border-mu"
        />
        <span className="text-13.5 text-mu">tNIGHT</span>
      </div>
    </div>
  );
}
