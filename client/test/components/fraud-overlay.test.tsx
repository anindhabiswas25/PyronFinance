// The fraud-proof overlay on a real caught mismatch: the trade engine runs the sample scenario, whose
// third dealer signs a price that doesn't open its seal, with real sealing and signatures.

import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NETWORKS } from '../../src/config/networks';
import { DataProvider, PortsFactoryContext } from '../../src/data/DataProvider';
import { SubmitFraudProofDialog } from '../../src/overlays/SubmitFraudProof';
import { TradeEngine } from '../../src/features/trade/engine';
import { useRfq } from '../../src/state/rfq';
import { useWalletStore } from '../../src/state/wallet';
import { splitSlash } from '../../src/lib/slash';
import { fmtBase } from '../../src/features/shared/protocol';
import { createFixturePorts, type FixturePorts } from '../fixtures';
import { FIXTURE_WALLET_RDNS } from '../fixtures/wallet';

const network = NETWORKS.preprod;
let engine: TradeEngine | undefined;
let ports: FixturePorts | undefined;
afterEach(() => {
  engine?.dispose();
  ports?.chain.dispose();
});

async function caughtMismatch() {
  sessionStorage.clear();
  ports = createFixturePorts(network, 'happy', 20);
  const pair = network.pairs[0].code;
  useRfq.getState().attach(ports.storage.session, pair);
  useRfq.getState().dispatch({ type: 'reset', pair });
  engine = new TradeEngine(ports, () => network.defaultRelays);
  await ports.wallet.connect(FIXTURE_WALLET_RDNS, network.walletNetworkId);
  await engine.request({ pair, side: 'sell', size: '1000', windowSecs: 120 });
  const deadline = Date.now() + 15_000;
  for (;;) {
    await engine.tick();
    const q = Object.values(useRfq.getState().state.quotes).find((x) => x.reveal === 'seal-mismatch');
    if (q) return q;
    if (Date.now() > deadline) throw new Error('no seal mismatch');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('submit fraud proof', () => {
  it('checks the reveal against the chain, shows the 60/10/30 payout and submits the proof', async () => {
    const fraud = await caughtMismatch();
    const p = ports!;
    act(() => useWalletStore.getState().set({ status: 'connected' }));
    render(
      <PortsFactoryContext.Provider value={() => p}>
        <DataProvider>
          <SubmitFraudProofDialog open onClose={() => undefined} quoteId={fraud.quoteId} />
        </DataProvider>
      </PortsFactoryContext.Provider>,
    );

    expect(await screen.findByText('✓ Does not open the on-chain seal', {}, { timeout: 5000 })).toBeTruthy();
    const bond = (await p.chain.dealer(fraud.dealerCmt)).bond!.amount;
    const split = splitSlash(bond);
    expect(screen.getByRole('table', { name: 'What the slash pays' }).textContent).toContain(`${fmtBase(split.selfProving)} tNIGHT`);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: new RegExp(`^Slash bond · receive ${fmtBase(split.selfProving).replace('.', '\\.')}`) }));
    expect(await screen.findByText('Bond slashed', {}, { timeout: 5000 })).toBeTruthy();

    const call = p.circuits.calls.at(-1)!;
    expect(call.circuit).toBe('submitFraudProofMismatch');
    const [quoteId, terms, nonce, signature, beneficiary] = call.args as [Uint8Array, bigint[], Uint8Array, { response: bigint }, Uint8Array];
    const sdk = await import('@otc/sdk/browser');
    expect(sdk.bytesToHex(quoteId)).toBe(fraud.quoteId);
    expect(terms).toEqual(sdk.encodeTerms(fraud.terms!));
    expect(sdk.bytesToHex(nonce)).toBe(fraud.nonce);
    expect(typeof signature.response).toBe('bigint');
    expect(sdk.bytesToHex(beneficiary)).toBe(sdk.midnightKeyToHex(await p.wallet.address(), 'addr'));
  }, 30_000);

  it('refuses a reveal that opens its seal', async () => {
    await caughtMismatch();
    const honest = Object.values(useRfq.getState().state.quotes).find((x) => x.reveal === 'revealed')!;
    const p = ports!;
    render(
      <PortsFactoryContext.Provider value={() => p}>
        <DataProvider>
          <SubmitFraudProofDialog
            open
            onClose={() => undefined}
            quoteId={honest.quoteId}
            reveal={{ dealerCmt: honest.dealerCmt, terms: honest.terms!, nonce: honest.nonce!, signature: (honest.signature ?? honest.message!.sig)! }}
          />
        </DataProvider>
      </PortsFactoryContext.Provider>,
    );
    expect(await screen.findByText('This reveal opens its seal. There is no fraud to prove.', {}, { timeout: 5000 })).toBeTruthy();
  }, 30_000);
});
