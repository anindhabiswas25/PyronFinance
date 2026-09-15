import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NETWORKS } from '../../src/config/networks';
import { resetDealerForTests, useDealer } from '../../src/features/desk/dealerVault';
import { useWalletStore } from '../../src/state/wallet';
import { renderApp } from '../render';
import { FIXTURE_WALLET_RDNS } from '../fixtures/wallet';

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:key'), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetDealerForTests();
});

describe('/desk', () => {
  it('generates a key, blocks every action until the backup is confirmed, then posts a bond with that key', async () => {
    const user = userEvent.setup();
    const app = renderApp('/desk?tab=keys');
    await screen.findByRole('heading', { level: 1, name: 'Desk' });

    await user.type(await screen.findByLabelText('Passphrase'), 'correct horse battery');
    await user.type(screen.getByLabelText('Passphrase again'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Generate key' }));
    expect(await screen.findByRole('heading', { name: 'Save your backup before using this key' }, { timeout: 10_000 })).toBeTruthy();

    await act(async () => {
      await app.ports().wallet.connect(FIXTURE_WALLET_RDNS, NETWORKS.preprod.walletNetworkId);
      useWalletStore.getState().set({ status: 'connected' });
    });

    await user.click(screen.getByRole('tab', { name: 'Bond' }));
    expect(await screen.findAllByText(/Save a backup of your dealer key first/)).not.toHaveLength(0);
    expect((screen.getByRole('button', { name: 'Post bond' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('tab', { name: 'Keys' }));
    const confirm = screen.getByRole('button', { name: 'Confirm backup' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Download backup' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    await user.click(screen.getByLabelText('I stored the backup somewhere safe'));
    await user.click(confirm);
    expect(await screen.findByText(/^Confirmed /)).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Bond' }));
    await user.type(await screen.findByLabelText('Bond amount'), '100');
    const post = screen.getByRole('button', { name: 'Post bond' }) as HTMLButtonElement;
    expect(post.disabled).toBe(false);
    await user.click(post);
    expect(await screen.findByText('Post bond: done', {}, { timeout: 5000 })).toBeTruthy();

    const call = app.ports().circuits.calls.at(-1)!;
    const identity = useDealer.getState().identity!;
    expect(call.circuit).toBe('postBond');
    expect(call.args[0]).toBe(100_000_000n);
    expect(call.args[1]).toEqual(identity.quotePk);
    expect(call.dealerSecretKey).toEqual(identity.secret);
    expect(within(screen.getByRole('list', { name: 'Bond lifecycle' })).getAllByRole('listitem')).toHaveLength(4);
  }, 60_000);

  it('opens any dealer read-only and asks for a key before acting', async () => {
    const user = userEvent.setup();
    renderApp(`/desk?dealer=${'ab'.repeat(32)}&tab=bond`);
    expect(await screen.findByRole('heading', { name: 'Bond actions need your dealer key' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(await screen.findByText(/Read-only: unlock this dealer’s key to act/)).toBeTruthy();
  });
});
