import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

test('an interrupted deposit scan keeps saved history visible and offers retry', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'deposit-error'));
  await page.goto('/org/demo/reports');
  await expect(page.getByRole('status').filter({ hasText: 'HTTP 503' })).toContainText('Last completed refresh:');
  await expect(page.getByRole('button', { name: 'Refresh history', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Export all matches/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Refresh history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
});

test('a long history refresh can continue while the finance team uses other pages', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'deposit-progress'));
  await page.goto('/org/demo/reports');
  await expect(page.getByRole('status').filter({ hasText: 'Refreshing account history' })).toContainText('You can leave this page');
  await expect(page.getByRole('button', { name: 'Refreshing history…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Export all matches/ })).toBeEnabled();
  await page.getByRole('link', { name: 'Recipients', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recipients', exact: true })).toBeVisible();
});
