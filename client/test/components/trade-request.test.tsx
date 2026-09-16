import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../render';

const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('request swap card', () => {
  it('flips sell and buy, putting what the taker gives on top, and never shows a price', async () => {
    const user = userEvent.setup();
    renderApp('/trade');
    await screen.findByRole('heading', { level: 1, name: 'Request quotes' });
    expect(before(screen.getByText('You sell'), screen.getByText('You receive'))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Switch to buying tNIGHT' }));
    expect(before(screen.getByText('You pay'), screen.getByText('You buy'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Switch to selling tNIGHT' })).toBeTruthy();

    await user.type(screen.getByLabelText('You buy'), '250');
    expect(screen.getByText('Price revealed after dealers seal')).toBeTruthy();
    expect((screen.getByLabelText('You buy') as HTMLInputElement).value).toBe('250');
  });
});
