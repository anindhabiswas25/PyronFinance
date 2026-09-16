import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NETWORKS } from '../../src/config/networks';
import { DataProvider, PortsFactoryContext, type PortsFactory } from '../../src/data/DataProvider';
import { createStorage } from '../../src/data/storage';
import { AttachDisclosureNoteDialog, noteKey, type SavedNote } from '../../src/overlays/AttachDisclosureNote';
import { useWalletStore } from '../../src/state/wallet';
import { useTray } from '../../src/state/tray';
import type { LocalReceipt } from '../../src/features/trade/engine';
import { createFixturePorts, type FixturePorts } from '../fixtures';
import { FIXTURE_WALLET_RDNS } from '../fixtures/wallet';

const quoteId = 'a3'.repeat(32);
const receipt: LocalReceipt = {
  quoteId,
  dealerCmt: '4f'.repeat(32),
  network: 'preprod',
  source: 'fixture',
  pair: 'tNIGHT/TESTUSD',
  takerSide: 'sell',
  size: '0.001',
  price: '41.315680',
  amount: 41_316n,
  baseSymbol: 'tNIGHT',
  counterSymbol: 'TESTUSD',
  counterDecimals: 6,
  txHash: 'cd'.repeat(32),
  blockHeight: 2_543_000,
  settledAt: 1_789_400_000,
  others: [],
};

let ports: FixturePorts | undefined;
const factory: PortsFactory = (network) => (ports = createFixturePorts(network, 'happy', 50));

function renderDialog(id = quoteId) {
  return render(
    <PortsFactoryContext.Provider value={factory}>
      <DataProvider>
        <AttachDisclosureNoteDialog open onClose={() => undefined} quoteId={id} />
      </DataProvider>
    </PortsFactoryContext.Provider>,
  );
}

describe('attach disclosure note', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:note'), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('explains when the trade was not settled in this browser', () => {
    renderDialog('99'.repeat(32));
    expect(screen.getByText('This trade’s details aren’t on this device')).toBeTruthy();
  });

  it('saves the sealed note, attaches only its hash and hint on-chain, and opens for the recipient only', async () => {
    const user = userEvent.setup();
    createStorage('fixture:preprod').session.set(`receipt:${quoteId}`, receipt);
    renderDialog();
    await act(async () => {
      await ports!.wallet.connect(FIXTURE_WALLET_RDNS, NETWORKS.preprod.walletNetworkId);
      useWalletStore.getState().set({ status: 'connected' });
    });

    const sdk = await import('@otc/sdk/browser');
    const recipient = sdk.generateEncKeypair();
    const stranger = sdk.generateEncKeypair();
    const attach = screen.getByRole('button', { name: 'Save note and attach' }) as HTMLButtonElement;
    await user.type(screen.getByLabelText('Recipient’s public key'), 'abc');
    expect(screen.getByText('A recipient key is 32 bytes: 64 hex characters.')).toBeTruthy();
    expect(attach.disabled).toBe(true);
    await user.clear(screen.getByLabelText('Recipient’s public key'));
    await user.type(screen.getByLabelText('Recipient’s public key'), sdk.bytesToHex(recipient.pk));
    await user.type(screen.getByLabelText('Reference (optional)'), 'invoice 114');
    await user.click(attach);

    expect(await screen.findByText('Note attached on-chain', {}, { timeout: 5000 })).toBeTruthy();
    const saved = createStorage('fixture:preprod').session.get<SavedNote>(noteKey(quoteId))!;
    expect(saved.blob.ct).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalled();

    const call = ports!.circuits.calls.at(-1)!;
    expect(call.circuit).toBe('attachDisclosureNote');
    const [tradeId, ciphertextHash, policyTag, hint] = call.args as [Uint8Array, Uint8Array, bigint, Uint8Array];
    expect(sdk.bytesToHex(tradeId)).toBe(quoteId);
    expect(sdk.bytesToHex(ciphertextHash)).toBe(sdk.bytesToHex(sdk.ciphertextHashOf(saved.blob)));
    expect(policyTag).toBe(1n);
    expect(sdk.bytesToHex(hint)).toBe(sdk.bytesToHex(sdk.recipientHintFor(recipient.pk)));

    const note = sdk.openNote(saved.blob, recipient.sk, quoteId);
    expect(note).toMatchObject({ tradeId: quoteId, side: 'buy', price: '41.315680', size: '0.001', parties: { reference: 'invoice 114' } });
    expect(() => sdk.openNote(saved.blob, stranger.sk, quoteId)).toThrow(/AEAD authentication failed/);
    expect(useTray.getState().entries[0]).toMatchObject({ kind: 'disclosure', status: 'done' });
    expect(within(document.body).getByRole('button', { name: 'Download the sealed note again' })).toBeTruthy();
  });
});
