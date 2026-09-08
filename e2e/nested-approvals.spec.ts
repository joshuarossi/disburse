import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) {
  test(`nested Payroll explains Treasury approval and reviews the signing account in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => { localStorage.setItem('theme', theme); sessionStorage.setItem('qa:scenario', 'nested-partial'); }, theme);
    await page.goto('/org/demo/disbursements?focus=p1');
    const dialog = page.getByRole('dialog', { name: 'Payment details' });
    await expect(dialog).toContainText('0 of 1 required approvals received');
    const treasury = dialog.getByRole('region', { name: 'Treasury approvals' });
    await expect(treasury).toContainText('1 of 2 approvals received');
    await expect(treasury).toContainText('one approval for Payroll');
    await expect(treasury.getByRole('listitem').filter({ hasText: 'Alex Morgan' })).toContainText('Awaiting approval');
    await expect(dialog.getByRole('button', { name: 'Send payment', exact: true })).toHaveCount(0);
    await treasury.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/qa/nested-approvals-${theme}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
    const path = dialog.getByRole('region', { name: 'Choose approval account' });
    await expect(path).toContainText('Treasury → Payroll');
    await expect(path.getByRole('radio')).toBeChecked();
    await expect(path.getByRole('button', { name: 'Confirm approval in wallet' })).toBeEnabled();
    await path.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/qa/nested-approval-path-${theme}.png`, fullPage: true });
    expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await path.getByRole('button', { name: 'Back to payment' }).click();
    await expect(path).toHaveCount(0);
    await page.reload();
    await expect(treasury).toContainText('1 of 2 approvals received');
  });
}
test('the parent contributes one approval only when its full threshold is verified', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'nested-ready'));
  await page.goto('/org/demo/disbursements?focus=p1');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('1 of 1 required approvals received');
  await expect(dialog.getByRole('region', { name: 'Treasury approvals' })).toContainText('2 of 2 approvals received');
  await expect(dialog.getByRole('button', { name: 'Approved by you', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Review execution fee', exact: true })).toBeEnabled();
});
test('an unavailable parent verification cannot enable approval or sending', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'nested-outage'));
  await page.goto('/org/demo/disbursements?focus=p1');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Send payment', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: 'Treasury approvals' })).toHaveCount(0);
});
test('a declined native request offers the original payment after reload, while an uncertain broadcast offers settlement checking', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'native-declined'));
  await page.goto('/org/demo/disbursements?focus=p1');
  const recovery = page.getByRole('region', { name: 'Payment recovery' });
  await expect(recovery.getByRole('button', { name: 'Retry original payment' })).toBeEnabled();
  await page.reload();
  await expect(recovery).toContainText('Your original payment authorization is saved');
  await page.evaluate(() => sessionStorage.setItem('qa:scenario', 'native-recovery'));
  await page.goto('/org/demo/disbursements?focus=p2');
  await expect(recovery.getByRole('button', { name: 'Retry original payment' })).toHaveCount(0);
  await expect(recovery.getByRole('button', { name: 'Check settlement' })).toBeEnabled();
});
