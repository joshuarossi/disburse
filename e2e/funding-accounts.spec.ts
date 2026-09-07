import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'multiple-accounts'));
});

for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) {
  test(`payroll uses the selected account without changing Maya's instructions in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    await page.goto('/org/demo/disbursements?new=1');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'Select Maya Chen' }).check();
    await dialog.getByLabel('Amount for Maya Chen', { exact: true }).fill('10.000001');
    const account = dialog.getByLabel('Funding account on Base', { exact: true });
    await expect(account).toHaveValue('');
    await dialog.getByRole('button', { name: 'Continue to timing' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Choose the funding account for Base');
    await account.selectOption('payroll-safe');
    await expect(dialog.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue to timing' }).click();
    await dialog.getByLabel('Payment name').fill('September payroll review');
    await dialog.getByRole('button', { name: 'Review payment', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible();
    const preview = width < 640 ? dialog.getByRole('list', { name: 'Recipient payout review' }) : dialog.getByRole('table');
    await expect(preview).toContainText('10.000001 USDC');
    await dialog.getByRole('button', { name: 'Save payment draft', exact: true }).click();
    const call = await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa:lastMutation')!));
    expect(call.name).toBe('paymentRuns:createGrouped');
    expect(call.args.recipients).toEqual([{ beneficiaryId: 'r0', amount: '10.000001', token: 'USDC', chainId: 8453, safeId: 'payroll-safe' }]);
    await expect(dialog.getByRole('alert')).toContainText('read-only');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/qa/funding-accounts-${theme}.png`, fullPage: true });
  });
}

test('Accounts carries the exact Payroll account into a new payment', async ({ page }) => {
  await page.goto('/org/demo/treasury');
  const payroll = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Payroll', exact: true }) })
    .filter({ has: page.getByRole('link', { name: 'Make a payment', exact: true }) }).last();
  await payroll.getByRole('link', { name: 'Make a payment', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Maya Chen' }).check();
  await expect(page.getByLabel('Funding account on Base')).toHaveValue('payroll-safe');
});

test('settings can connect a second named account on an already connected network', async ({ page }) => {
  await page.goto('/org/demo/settings?tab=safe');
  await page.getByRole('button', { name: 'Connect another account', exact: true }).click();
  await page.getByLabel('Account name', { exact: true }).fill('Reserves');
  await expect(page.locator('#funding-account-network')).toContainText('Base');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
});
