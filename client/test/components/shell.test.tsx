import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from '../../src/design/primitives';
import { PortsFactoryContext } from '../../src/data/DataProvider';
import { createLivePorts } from '../../src/data/live';
import { useContext, useState } from 'react';
import { renderApp as renderAt } from '../render';

describe('app shell', () => {
  it.each([
    ['/', 'Quotes a dealer can’t take back.'],
    ['/activity', 'Activity'],
    ['/dealers', 'Dealers'],
    ['/dealers/abcd', 'Dealer'],
    ['/trade', 'Request quotes'],
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

  it('builds live adapters unless a test swaps them', () => {
    let factory: unknown;
    function Probe() {
      factory = useContext(PortsFactoryContext);
      return null;
    }
    render(<Probe />);
    expect(factory).toBe(createLivePorts);
  });

  it('has no data-source switch in the address', async () => {
    renderAt('/activity?data=fixture');
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
