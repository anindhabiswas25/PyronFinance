import { afterEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStorage } from '../../src/data/storage';
import { PENDING_KEY, resetHistoryForTests, type TradeHistoryEntry } from '../../src/data/history';
import { renderApp } from '../render';

const entry = (id: string, outcome: TradeHistoryEntry['outcome']): TradeHistoryEntry => ({
  id,
  network: 'preprod',
  pair: 'tNIGHT/TESTUSD',
  takerSide: 'sell',
  size: '0.001',
  dealerCmt: '4f'.repeat(32),
  outcome,
  price: '41.315680',
  amount: 41_316n,
  baseSymbol: 'tNIGHT',
  counterSymbol: 'TESTUSD',
  counterDecimals: 6,
  txHash: outcome === 'settled' ? 'cd'.repeat(32) : undefined,
  failure: outcome === 'failed' ? { reason: 'inputs-spent', detail: 'The coins behind this offer were already spent.' } : undefined,
  at: 1_789_400_000,
});

afterEach(() => resetHistoryForTests());

describe('/me', () => {
  it('creates an encrypted history, adds the session’s trades, locks, refuses a wrong passphrase, unlocks and deletes', async () => {
    const user = userEvent.setup();
    createStorage('fixture:preprod').session.set(PENDING_KEY, [entry('a1'.repeat(32), 'settled'), entry('b2'.repeat(32), 'failed')]);
    renderApp('/me');

    expect(await screen.findByText('2 trades from this session will be added when you unlock')).toBeTruthy();
    await user.type(await screen.findByLabelText('Passphrase'), 'correct horse battery');
    await user.type(screen.getByLabelText('Passphrase again'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create history' }));

    const table = await screen.findByRole('table', { name: 'Trades, all' }, { timeout: 10_000 });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    await user.click(screen.getByRole('radio', { name: /Failed 1/ }));
    expect(within(await screen.findByRole('table', { name: 'Trades, failed' })).getByText('The coins behind this offer were already spent.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Lock' }));
    await user.type(await screen.findByLabelText('Passphrase'), 'wrong horse battery');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('That passphrase doesn’t unlock this history', {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    await user.clear(screen.getByLabelText('Passphrase'));
    await user.type(screen.getByLabelText('Passphrase'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(within(await screen.findByRole('table', { name: 'Trades, all' }, { timeout: 10_000 })).getAllByRole('row')).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Delete all' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete your trade history?' });
    const del = within(dialog).getByRole('button', { name: 'Delete everything' }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText(/to confirm/), 'delete my history');
    await user.click(del);
    expect(await screen.findByRole('heading', { name: 'Keep an encrypted history' })).toBeTruthy();
  }, 60_000);
});
