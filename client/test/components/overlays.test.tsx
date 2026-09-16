import { describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelaysPill } from '../../src/app/TopBarActions';
import { useTray } from '../../src/state/tray';
import { useRelayList } from '../../src/state/relays';
import { renderApp as renderAt } from '../render';

describe('relays pill', () => {
  it.each([
    [0, 'text-bad'],
    [1, 'text-warn'],
    [2, ''],
  ])('with %i relays uses tone %s and says so in words', (count, tone) => {
    render(<RelaysPill count={count} socketsOpen={false} onClick={() => undefined} />);
    const pill = screen.getByRole('button', { name: new RegExp(`^${count} relays? reachable`) });
    if (tone) expect(pill.className).toContain(tone);
    else expect(pill.className).not.toMatch(/text-(bad|warn)/);
    if (count < 2) expect(pill.getAttribute('aria-label')).toMatch(/need at least 2/);
  });
});

describe('connect wallet (sample data)', () => {
  it('lists the sample wallet, connects, and shows the address pill', async () => {
    const user = userEvent.setup();
    renderAt('/activity');
    await user.click(await screen.findByRole('button', { name: /Connect wallet/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect a wallet' });
    expect(within(dialog).getByText(/Part of the sample data, not a browser extension/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Sample wallet/ }));
    expect(await screen.findByRole('button', { name: /^Wallet mn_addr_preprod1sampledata/ }, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Connect a wallet' })).toBeNull();
  });

  it('readiness lists truthful checks only: no coin count claim', async () => {
    const user = userEvent.setup();
    renderAt('/activity');
    await user.click(await screen.findByRole('button', { name: /Connect wallet/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Sample wallet/ }));
    await user.click(await screen.findByRole('button', { name: /^Wallet mn_addr/ }, { timeout: 3000 }));
    const dialog = await screen.findByRole('dialog', { name: 'Wallet readiness' });
    expect(await within(dialog).findByText('Network is Preprod')).toBeTruthy();
    expect(await within(dialog).findByText('DUST available for fees')).toBeTruthy();
    expect(within(dialog).getByText('Coin shape is checked when you settle')).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/\d+ (tNIGHT |DUST )?coins?\b/);
  });
});

describe('transaction tray', () => {
  it('opens with T, survives a reload, and marks interrupted work', async () => {
    const user = userEvent.setup();
    act(() => {
      useTray.getState().start({
        kind: 'settle',
        title: 'Settle with 0f7a…91',
        source: 'fixture',
        stages: [
          { id: 'balance', label: 'Wallet balances the offer', status: 'done' },
          { id: 'submit', label: 'Submitting', status: 'active' },
        ],
      });
    });
    const first = renderAt('/dealers');
    await screen.findByRole('heading', { level: 1, name: 'Dealers' });
    await user.keyboard('t');
    const drawer = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(within(drawer).getByText('Settle with 0f7a…91')).toBeTruthy();
    await user.keyboard('{Escape}');
    first.unmount();

    // Reload: state comes back from sessionStorage.
    act(() => useTray.setState({ entries: [] }));
    act(() => useTray.getState().hydrate());
    renderAt('/verify');
    await user.click(await screen.findByRole('button', { name: /1 in progress/ }));
    const again = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(within(again).getByText(/page reloaded while this was running/)).toBeTruthy();
  });

  it('does not open while typing', async () => {
    const user = userEvent.setup();
    renderAt('/dealers');
    const search = await screen.findByPlaceholderText('Search by dealer key');
    await user.click(search);
    await user.keyboard('t');
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
  });
});

describe('relays overlay', () => {
  it('removes a relay, warns below two, and validates additions', async () => {
    const user = userEvent.setup();
    act(() => useRelayList.setState({ lists: {} }));
    renderAt('/dealers');
    await user.click(await screen.findByRole('button', { name: /Manage relays/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Relays' });
    await within(dialog).findAllByText(/^Reachable/);
    await user.click(within(dialog).getByRole('button', { name: /Remove ws:\/\/127\.0\.0\.1:18788\/gossip/ }));
    expect(await within(dialog).findByText('Only one relay')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Add a relay'), 'https://nope');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText(/Relays speak WebSocket/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Reset to defaults' })).toBeTruthy();
  });
});
