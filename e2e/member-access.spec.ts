import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) {
  test(`member access explains role, budget and actual authority in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    await page.goto('/org/demo/team');
    await page.getByRole('button', { name: 'View access for Jordan Lee', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Access for Jordan Lee' });
    await expect(dialog.getByRole('region', { name: 'App payment limits' })).toContainText('$5,000.00 USDC');
    await expect(dialog.getByRole('region', { name: 'App payment limits' })).toContainText('$25,000.00 USDC');
    await expect(dialog.getByText('Can sign for this account', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/This member cannot authorize a payment alone/)).toBeVisible();
    const grants = dialog.getByRole('region', { name: 'Spending grants version 1.0.0' });
    await expect(grants).toContainText('$20,500.00 USDC available under this grant');
    await expect(grants).toContainText('Every 30 days');
    await expect(grants).toContainText('Next reset:');
    expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await dialog.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: `.local/qa/member-access-${theme}.png`, fullPage: true });
    await grants.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/qa/member-grants-${theme}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Manage limits', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Payment limits', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}
for (const [scenario, expected] of [['access-viewer', 'Account owner · Cannot sign through this workspace role'], ['access-invited', 'No workspace access until this invitation is accepted.']] as const) {
  test(`${scenario} does not confuse workspace access with contract authority`, async ({ page }) => {
    await page.addInitScript(s => sessionStorage.setItem('qa:scenario', s), scenario);
    await page.goto('/org/demo/team');
    await page.getByRole('button', { name: 'View access for Jordan Lee', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(expected);
    await expect(dialog.getByRole('region', { name: 'Payment permissions' })).toContainText('Not allowed through this role');
    await expect(dialog.getByText('$20,500.00 USDC available under this grant', { exact: true })).toBeVisible();
    await expect(dialog).toContainText('This workspace role cannot use the grant in Disburse.');
  });
}
test('a failed account check cannot display remembered owner authority', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'funding-outage'));
  await page.goto('/org/demo/team');
  await page.getByRole('button', { name: 'View access for Jordan Lee', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Account authority could not be verified');
  await expect(page.getByText('Can sign for this account', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Spending grants version 1.0.0' })).toHaveCount(0);
});
test('a grant RPC failure is not reported as no grants', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'access-grants-outage'));
  await page.goto('/org/demo/team');
  await page.getByRole('button', { name: 'View access for Jordan Lee', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Spending grants could not be verified');
  await expect(dialog.getByText(/No grants recorded/)).toHaveCount(0);
});
test('disabled grants remain visible with zero transfer authority', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'access-disabled'));
  await page.goto('/org/demo/team');
  await page.getByRole('button', { name: 'View access for Jordan Lee', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('These grants are dormant');
  await expect(dialog).toContainText('$0.00 USDC available under this grant');
  await expect(dialog).toContainText('Limit $25,000.00 USDC');
});
test('legacy grants are called out while new legacy grants are unavailable', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'access-legacy'));
  await page.goto('/org/demo/team');
  await page.getByRole('button', { name: 'View access for Jordan Lee', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Spending grants version 0.1.1' })).toContainText('known replay vulnerability');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('tab', { name: 'Delegated spending', exact: true }).click();
  await page.getByText('Advanced policy settings', { exact: true }).click();
  await page.getByLabel('Allowance module', { exact: true }).selectOption('0xAA46724893dedD72658219405185Fb0Fc91e091C');
  await expect(page.getByRole('button', { name: 'Set allowance', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revoke', exact: true })).toBeVisible();
});
