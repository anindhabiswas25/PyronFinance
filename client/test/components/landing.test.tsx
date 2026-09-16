// The landing page at /: outside the app shell, scaled on its own, and "Launch App" opens the trading
// terminal without leaving the landing's root scale behind.

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../render';

describe('landing page', () => {
  it('renders without the app top bar, and Launch App opens the trading terminal', async () => {
    const user = userEvent.setup();
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Private OTC on Midnight' })).toBeTruthy();
    expect(document.documentElement.classList.contains('pl-html')).toBe(true);
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();

    const launch = screen.getAllByRole('link', { name: /Launch App/ });
    expect(launch.length).toBeGreaterThan(0);
    for (const link of launch) expect(link.getAttribute('href')).toBe('/trade');

    await user.click(launch[0]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Request quotes' }, { timeout: 10_000 })).toBeTruthy();
    expect(document.documentElement.classList.contains('pl-html')).toBe(false);
    expect(screen.getAllByRole('navigation', { name: 'Primary' }).length).toBeGreaterThan(0);
  });

  it('makes no waitlist promise it has no backend for', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Private OTC on Midnight' });
    expect(screen.queryByText(/waitlist|get in touch/i)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
