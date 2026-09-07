import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) {
  test(`a pending nested cancellation hides the original send controls and reviews parent approvals in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => { localStorage.setItem('theme', theme); sessionStorage.setItem('qa:scenario', 'cancel-nested'); }, theme);
    await page.goto('/org/demo/disbursements?focus=p1');
    const dialog = page.getByRole('dialog', { name: 'Payment details' });
    const cancellation = dialog.getByRole('region', { name: 'Account cancellation' });
    await expect(dialog).toContainText('Cancellation pending');
    await expect(cancellation).toContainText('budget remains reserved');
    await expect(cancellation).toContainText('Treasury · 1 of 2 approvals');
    await expect(dialog.getByRole('button', { name: 'Send payment', exact: true })).toHaveCount(0);
    await expect(cancellation.getByRole('button', { name: 'Complete cancellation' })).toBeDisabled();
    await cancellation.getByRole('checkbox').check();
    await cancellation.getByRole('button', { name: 'Approve cancellation' }).click();
    const path = cancellation.getByRole('region', { name: 'Choose approval account' });
    await expect(path).toContainText('Treasury → Payroll');
    await expect(path).toContainText('cancelling the original transaction');
    await path.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/qa/cancellation-${theme}.png`, fullPage: true });
    expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload();
    await expect(cancellation).toContainText('Cancellation requested');
    await expect(dialog.getByRole('button', { name: 'Send payment', exact: true })).toHaveCount(0);
  });
}
test('a signed payment cancellation reviews its own fee without changing the original payment', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'cancel-request'));
  await page.goto('/org/demo/disbursements?focus=p1');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cancel payment', exact: true }).click();
  const cancellation = dialog.getByRole('region', { name: 'Account cancellation' });
  await expect(cancellation).toContainText('0.05 USDC');
  await cancellation.getByRole('combobox', { name: 'Fee currency' }).selectOption('USDT');
  await expect(cancellation).toContainText('0.05 USDT');
  await cancellation.getByRole('combobox', { name: 'Cancellation fee' }).selectOption('wallet');
  await expect(cancellation).toContainText('No payment is sent to the original recipients');
  await cancellation.getByRole('checkbox').check();
  await cancellation.getByRole('button', { name: 'Request cancellation approval' }).click();
  await expect(cancellation.getByRole('alert')).toContainText('read-only');
});
test('a declined cancellation retries the same request and a confirmed one shows its receipt', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('qa:scenario')) sessionStorage.setItem('qa:scenario', 'cancel-declined'); });
  await page.goto('/org/demo/disbursements?focus=p1');
  const cancellation = page.getByRole('region', { name: 'Account cancellation' });
  await cancellation.getByRole('checkbox').check();
  await expect(cancellation.getByRole('button', { name: 'Retry original cancellation' })).toBeEnabled();
  await page.reload();
  await expect(cancellation.getByRole('button', { name: 'Retry original cancellation' })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('qa:scenario', 'cancel-confirmed'));
  await page.reload();
  await expect(cancellation).toContainText('The original transaction can no longer execute');
  await expect(cancellation.getByRole('link', { name: 'View cancellation receipt' })).toBeVisible();
  await expect(cancellation.getByRole('button', { name: 'Complete cancellation' })).toHaveCount(0);
});
