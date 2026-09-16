// The notification centre in the shell: entries and their actions, and a real sample trade that keeps
// running after the user leaves /trade, then brings them back to review.

import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useNotifications } from '../../src/state/notifications';
import { renderApp } from '../render';

describe('notification centre', () => {
  it('opens with N, groups what needs the user, and runs an action', async () => {
    const user = userEvent.setup();
    act(() => {
      useNotifications.getState().sync('test:', [
        { key: 'test:relays', kind: 'action', tone: 'warn', title: 'Only one relay connected', actions: [{ label: 'Manage relays', action: { type: 'manage-relays' } }] },
        { key: 'test:sent', kind: 'update', tone: 'neutral', title: 'Request sent', actions: [] },
      ]);
    });
    renderApp('/dealers');
    await screen.findByRole('heading', { level: 1, name: 'Dealers' });
    expect(screen.getByRole('button', { name: /1 needs you/ })).toBeTruthy();

    await user.keyboard('n');
    const drawer = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(within(drawer).getByRole('heading', { name: 'Needs you · 1' })).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'Updates · 1' })).toBeTruthy();

    await user.click(within(drawer).getByRole('button', { name: 'Manage relays' }));
    expect(await screen.findByRole('dialog', { name: 'Relays' })).toBeTruthy();
    expect(useNotifications.getState().entries.every((e) => e.read)).toBe(true);
  });

  it('keeps the trade running on another page, toasts, and brings the user back to review', async () => {
    const user = userEvent.setup();
    const app = renderApp('/trade', { speed: 20 });
    await screen.findByRole('heading', { level: 1, name: 'Request quotes' }, { timeout: 10_000 });
    await user.type(screen.getByLabelText('You sell'), '1000');
    const request = screen.getByRole('button', { name: /^Request quotes/ }) as HTMLButtonElement;
    await waitFor(() => expect(request.disabled).toBe(false), { timeout: 5000 });
    await user.click(request);
    await screen.findByRole('heading', { level: 1, name: /Waiting for dealers to seal|bound to a price/ }, { timeout: 10_000 });

    await act(() => app.router.navigate('/activity'));
    await screen.findByRole('heading', { level: 1, name: 'Activity' });

    const ready = () => useNotifications.getState().entries.find((e) => /ready to compare/.test(e.title) && !e.resolved);
    await waitFor(() => expect(ready()).toBeDefined(), { timeout: 20_000 });
    expect((await screen.findAllByRole('status')).some((t) => /ready to compare/.test(t.textContent ?? ''))).toBe(true);

    await user.click(screen.getByRole('button', { name: /^Notifications:/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(within(drawer).queryByRole('button', { name: /^Settle/ })).toBeNull();
    await user.click(within(drawer).getAllByRole('button', { name: 'Review quotes' })[0]);

    expect(await screen.findByRole('heading', { level: 1, name: 'Compare quotes' }, { timeout: 5000 })).toBeTruthy();
    await waitFor(() => expect(ready()).toBeUndefined());
  }, 60_000);
});
