import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) {
  test(`review all account movements and export their matching evidence in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => { localStorage.setItem('theme', theme); sessionStorage.setItem('qa:scenario', 'report-account-history'); }, theme);
    await page.goto('/org/demo/reports');
    await expect(page.getByText('Maya Chan', { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(page.getByText('Unmatched outflow', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText('Outflow: 1,295.250001 USDC', { exact: true })).toBeVisible();
    await page.getByText('History coverage', { exact: true }).click();
    await expect(page.getByText('Incoming and outgoing history checked through 2026-09-06 11:59:00 UTC')).toBeVisible();
    await expect(page.getByText('These are recorded movements. Opening and closing balances still need to be reconciled.')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export all matches', exact: true }).click();
    const chunks: Buffer[] = [];
    for await (const chunk of (await (await download).createReadStream())!) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString('utf8');
    expect(csv.split('\n')).toHaveLength(3);
    for (const expected of ['Chain transfer ID', 'Raw asset units', 'Activity timestamp UTC', 'Observed timestamp UTC', 'saved-transfer-1', 'saved-transfer-2', '2026-08-31T23:59:59.000Z', '2026-09-02T00:00:00.000Z', '1250000001']) expect(csv).toContain(expected);
    expect(csv.match(/Maya Chan/g)).toHaveLength(1);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/qa/account-history-${theme}.png`, fullPage: true });
  });
}

test('a legacy payment mismatch is visible and excluded while the actual account transfer stays in totals', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('theme', 'light'); sessionStorage.setItem('qa:scenario', 'report-account-history-pending'); });
  await page.goto('/org/demo/reports');
  await expect(page.getByText('Transfer match pending · excluded', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Outflow: 1,295.250001 USDC', { exact: true })).toBeVisible();
  await expect(page.getByText('Unmatched outflow', { exact: true }).filter({ visible: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all matches', exact: true }).click();
  const chunks: Buffer[] = [];
  for await (const chunk of (await (await download).createReadStream())!) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv.split('\n')).toHaveLength(4);
  expect(csv.split('\n').find(line => line.includes('Legacy payment record'))).toContain('pending');
  expect(await page.locator('table').evaluate(table => table.getBoundingClientRect().width <= table.parentElement!.getBoundingClientRect().width)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '.local/qa/account-history-mismatch.png', fullPage: true });
});
