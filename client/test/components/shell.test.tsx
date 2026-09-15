import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from '../../src/app/router';
import { Dialog } from '../../src/design/primitives';
import { useState } from 'react';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('app shell', () => {
  it.each([
    ['/', 'Quotes a dealer can’t take back.'],
    ['/activity', 'Activity'],
    ['/dealers', 'Dealers'],
    ['/dealers/abcd', 'Dealer'],
    ['/trade', 'Trade'],
    ['/trade/abcd', 'Trade receipt'],
    ['/me', 'My trades'],
    ['/deal', 'Quote with a bond, not a sign-up.'],
    ['/desk', 'Desk'],
    ['/verify', 'Verify'],
  ])('renders %s', async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
  });

  it('shows a not-found page for unknown routes', async () => {
    renderAt('/nope');
    expect(await screen.findByRole('heading', { name: 'No page at this address' })).toBeTruthy();
  });

  it('shows the sample-data banner in fixture mode', async () => {
    renderAt('/activity?data=fixture');
    expect(await screen.findByRole('note', { name: 'Sample data' })).toBeTruthy();
  });

  it('hides the banner in live mode', async () => {
    renderAt('/activity?data=live');
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    expect(screen.queryByRole('note', { name: 'Sample data' })).toBeNull();
  });

  it('cycles the theme and stamps data-theme', async () => {
    renderAt('/');
    const button = await screen.findAllByRole('button', { name: /^Theme:/ });
    await userEvent.click(button[0]);
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('Dialog', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Relays">
          <button>First</button>
          <button>Second</button>
        </Dialog>
      </>
    );
  }

  it('traps focus, closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Relays' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    const buttons = within(dialog).getAllByRole('button');
    buttons[buttons.length - 1].focus();
    await user.tab();
    expect(document.activeElement).toBe(buttons[0]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
