import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES: Array<[string, string]> = [
  ['/', 'Private OTC on Midnight'],
  ['/venue', 'Quotes a dealer can’t take back.'],
  ['/activity', 'Activity'],
  ['/dealers', 'Dealers'],
  [`/dealers/${'ab'.repeat(32)}`, `Dealer abab…ab`],
  ['/trade', 'Request quotes'],
  ['/trade/abcd', 'Trade receipt'],
  ['/me', 'My trades'],
  ['/deal', 'Quote with a bond, not a sign-up.'],
  ['/desk', 'Desk'],
  ['/desk?tab=keys', 'Desk'],
  ['/verify', 'Verify'],
  ['/verify?tab=note', 'Verify'],
  ['/no-such-page', 'No page at this address'],
];

for (const [path, heading] of ROUTES) {
  test(`${path} renders and passes axe (WCAG 2.1 AA)`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    // Let lazy chunks and first chain reads settle into their loaded, empty or error state.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
    expect(errors).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('the swap card flips sides and never shows a price', async ({ page }) => {
  await page.goto('/trade');
  await expect(page.getByText('You sell')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to buying tNIGHT' }).click();
  await expect(page.getByText('You pay')).toBeVisible();
  await page.getByLabel('You buy').fill('250');
  await expect(page.getByText('Price revealed after dealers seal')).toBeVisible();
});

test('Launch App on the landing page opens the trading terminal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Launch App/ }).first().click();
  await expect(page).toHaveURL(/\/trade$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Request quotes' })).toBeVisible();
  // The landing's 1rem = 1vw scale must not follow the user into the terminal.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('16px');
});

test('the theme toggle stamps data-theme', async ({ page }) => {
  await page.goto('/venue');
  // On narrow screens the theme and network controls live in the menu drawer.
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: /^Theme:/ }).locator('visible=true').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
});
