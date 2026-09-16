// Wallet readiness, limited to what the DApp Connector actually exposes: network, the balance of the
// asset the taker gives, DUST, and relays. The connector exposes no coin counts, so coin shape is not
// claimed here; Settle checks the merged transaction instead.

import { useCallback, useEffect, useState } from 'react';
import { useData } from './DataProvider';
import { useWalletStore } from '../state/wallet';
import { useRelays } from './useRelays';
import { tokenTypeOf } from '../config/networks';
import { formatUnits } from '../lib/format';
import { messageOf } from '../lib/errors';

export type CheckState = 'ok' | 'warn' | 'bad' | 'checking' | 'info';

export interface ReadinessCheck {
  id: 'network' | 'balance' | 'dust' | 'relays' | 'coins';
  state: CheckState;
  label: string;
  detail?: string;
}

const DUST_DECIMALS = 15;

export function useReadiness(params: { side?: 'buy' | 'sell'; size?: bigint }) {
  const { wallet, network } = useData();
  const walletState = useWalletStore();
  const relays = useRelays();
  const [balances, setBalances] = useState<Record<string, bigint>>();
  const [dust, setDust] = useState<{ cap: bigint; balance: bigint }>();
  const [error, setError] = useState<string>();
  const connected = walletState.status === 'connected';
  const pair = network.pairs[0];

  const refresh = useCallback(async () => {
    if (!connected) return;
    setError(undefined);
    try {
      const [b, d] = await Promise.all([wallet.balances(), wallet.dust()]);
      setBalances(b);
      setDust(d);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [wallet, connected]);

  useEffect(() => {
    setBalances(undefined);
    setDust(undefined);
    void refresh();
  }, [refresh]);

  const checks: ReadinessCheck[] = [];
  if (!connected) {
    checks.push({ id: 'network', state: 'bad', label: walletState.status === 'lost' ? 'Wallet disconnected' : 'No wallet connected', detail: 'Connect a wallet to check balances.' });
  } else if (walletState.config?.networkId !== network.walletNetworkId) {
    checks.push({ id: 'network', state: 'bad', label: `Wallet is on ${walletState.config?.networkId}`, detail: `Switch it to ${network.label}.` });
  } else {
    checks.push({ id: 'network', state: 'ok', label: `Network is ${network.label}` });
  }

  if (connected && pair) {
    const base = pair.base;
    const counter = pair.counter;
    if (error) {
      checks.push({ id: 'balance', state: 'bad', label: 'Couldn’t read balances', detail: error });
    } else if (!balances) {
      checks.push({ id: 'balance', state: 'checking', label: 'Reading balances…' });
    } else if (params.side !== 'buy') {
      const have = balances[tokenTypeOf(base)] ?? 0n;
      const want = params.size ?? 0n;
      const fmt = (v: bigint) => formatUnits(v, base.decimals);
      checks.push(
        want === 0n
          ? { id: 'balance', state: 'info', label: `${fmt(have)} ${base.symbol} available` }
          : have >= want
            ? { id: 'balance', state: 'ok', label: `Enough ${base.symbol} for ${fmt(want)}`, detail: `${fmt(have)} available` }
            : { id: 'balance', state: 'bad', label: `Not enough ${base.symbol}`, detail: `You hold ${fmt(have)}; this request sells ${fmt(want)}.` },
      );
    } else {
      const have = balances[tokenTypeOf(counter)] ?? 0n;
      checks.push({
        id: 'balance',
        state: 'info',
        label: `${formatUnits(have, counter.decimals)} ${counter.symbol} available`,
        detail: 'What you pay appears only after dealers reveal their prices; it is checked again before you settle.',
      });
    }
    if (!error) {
      checks.push(
        !dust
          ? { id: 'dust', state: 'checking', label: 'Reading DUST…' }
          : dust.balance > 0n
            ? { id: 'dust', state: 'ok', label: 'DUST available for fees', detail: `${formatUnits(dust.balance, DUST_DECIMALS, { maxFraction: 2 })} of ${formatUnits(dust.cap, DUST_DECIMALS, { maxFraction: 2 })} DUST` }
            : { id: 'dust', state: 'bad', label: 'No DUST for fees', detail: 'Settlement needs DUST. Hold tNIGHT registered for DUST generation and wait for it to accrue.' },
      );
    }
  }

  checks.push(
    relays.count >= 2
      ? { id: 'relays', state: 'ok', label: `${relays.count} relays ${relays.socketsOpen ? 'connected' : 'reachable'}` }
      : relays.count === 1
        ? { id: 'relays', state: 'warn', label: `Only 1 relay ${relays.socketsOpen ? 'connected' : 'reachable'}`, detail: 'Requests need at least 2, so one operator can’t hide dealers from you.' }
        : { id: 'relays', state: 'bad', label: 'No relay reachable', detail: 'Add relays or start local ones; requests need at least 2.' },
  );
  checks.push({
    id: 'coins',
    state: 'info',
    label: 'Coin shape is checked when you settle',
    detail: 'Apps can’t see how your balance is split into coins. Many small coins can make a settlement too heavy for the network; Settle checks the real transaction before submitting.',
  });

  const ready = checks.every((c) => c.state === 'ok' || c.state === 'info');
  return { checks, ready, refresh, balances, dust };
}
