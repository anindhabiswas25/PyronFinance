import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildDataset } from '../fixtures/dataset';
import { protocolTotals } from '../../src/data/selectors';
import { formatCount } from '../../src/lib/format';
import { renderApp as renderAt } from '../render';

const ds = buildDataset(1_789_450_000);

describe('Venue', () => {
  it('shows the fixture totals from the ledger, and no price', async () => {
    renderAt('/');
    const totals = protocolTotals(ds.ledger);
    const tile = await screen.findByText('Resolved quotes');
    expect(await within(tile.parentElement!).findByText(formatCount(totals.resolvedQuotes))).toBeTruthy();
    expect(within(screen.getByText('Bonds slashed').parentElement!).getByText('3')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bprice\s*[:=]?\s*\d/i);
  });
});

describe('Dealers', () => {
  it('lists slashed dealers under All and counts each tab', async () => {
    renderAt('/dealers');
    const table = await screen.findByRole('table', { name: /Dealers, all/ });
    expect(within(table).getAllByText('Slashed').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('tab', { name: /All\s*23/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Slashed\s*3/ })).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Slashed/ }));
    const slashedTable = await screen.findByRole('table', { name: /Dealers, slashed/ });
    expect(within(slashedTable).getAllByRole('row')).toHaveLength(4); // header + 3
  });

  it('shows Failures as unknown, never 0', async () => {
    renderAt('/dealers');
    await screen.findByRole('table', { name: /Dealers/ });
    expect(screen.getAllByText('(unknown: no public source of failure evidence yet)', { exact: false }).length).toBe(23);
  });
});

describe('Dealer profile', () => {
  it('says so when a key has never bonded', async () => {
    renderAt(`/dealers/${'ab'.repeat(32)}`);
    expect(await screen.findByRole('heading', { name: 'No dealer with this key has bonded' })).toBeTruthy();
  });

  it('shows a known dealer with a chart whose label lists every bond change', async () => {
    const a = ds.dealers.find((d) => d.role === 'a')!;
    renderAt(`/dealers/${a.dealerCmt}`);
    const chart = await screen.findByRole('img', { name: /Bond over time/ });
    expect(chart.getAttribute('aria-label')).toMatch(/bond posted .* topped up/);
  });
});

describe('Activity', () => {
  it('shows an error with retry when the indexer is down, never an empty list', async () => {
    renderAt('/activity', { scenario: 'indexer-down' });
    expect(await screen.findByRole('heading', { name: /Can’t reach the chain/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('No protocol events yet')).toBeNull();
  });
});

describe('Become a dealer', () => {
  it('sizes the bond with bigint math and prints the CLI amount in base units', async () => {
    renderAt('/deal');
    const input = await screen.findByLabelText(/Largest quote you want to give/);
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, '1000.5');
    expect(screen.getByText('50.025 tNIGHT')).toBeTruthy();
    expect(screen.getByLabelText('Dealer Node commands').textContent).toContain('--amount 50025000');
    await user.type(input, 'x');
    expect((input as HTMLInputElement).value).toBe('1000.5');
  });
});
