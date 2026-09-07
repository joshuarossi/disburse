import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) {
  test(`review and export a paginated finance history in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => { localStorage.setItem('theme', theme); sessionStorage.setItem('qa:scenario', 'report-paged'); }, theme);
    await page.goto('/org/demo/reports');
    await expect(page.getByText('Vendor 001', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText('Vendor 101', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Outflow: 151.000151 USDC', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.getByText('Vendor 151', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText('Vendor 001', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export all matches', exact: true }).click();
    const file = await download;
    const chunks = [];
    for await (const chunk of (await file.createReadStream())!) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString('utf8');
    expect(csv.split('\n')).toHaveLength(152);
    expect(csv).toContain('Reconciliation ID');
    expect(csv).toContain('Vendor 001'); expect(csv).toContain('Vendor 151');
    expect(csv).toContain('1.000001'); expect(csv).toContain('2026-09-06T00:00:00.000Z');
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('button', { name: 'USDT', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No transactions found' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next page', exact: true })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/qa/report-pagination-${theme}.png`, fullPage: true });
  });
}

test('a changed history stops the export and keeps its page available for retry', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'report-export-failure'));
  await page.goto('/org/demo/reports');
  const downloads: string[] = [];
  page.on('download', file => downloads.push(file.suggestedFilename()));
  await page.getByRole('button', { name: 'Export all matches', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('activity changed');
  expect(downloads).toEqual([]);
  await expect(page.getByRole('button', { name: 'Export all matches', exact: true })).toBeEnabled();
  await expect(page.getByText('Vendor 001', { exact: true }).filter({ visible: true })).toBeVisible();
});

test('unfinished history remains visible while complete totals and exports wait for recovery', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'report-index-busy'));
  await page.goto('/org/demo/reports');
  await expect(page.getByRole('status').filter({ hasText: 'needs attention' })).toContainText('invalid date');
  await expect(page.getByRole('button', { name: 'Export all matches', exact: true })).toBeDisabled();
  await expect(page.getByText('Vendor 001', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Outflow: 151.000151 USDC', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry history update' }).click();
  await page.getByRole('link', { name: 'Recipients', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recipients', exact: true })).toBeVisible();
});
