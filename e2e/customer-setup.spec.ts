import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
async function start(page: Page, scenario: string, options: { twoOwners?: boolean } = {}) {
  await page.addInitScript(value => sessionStorage.setItem('qa:scenario', value), `customer-setup-${scenario}`);
  await page.goto('/onboarding');
  await page.getByLabel('Name', { exact: true }).fill('Alex Morgan');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Organization name', { exact: true }).fill('Setup QA');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  if (options.twoOwners) {
    await page.getByRole('button', { name: 'Add a team member', exact: true }).click();
    await page.getByLabel('Wallet address *', { exact: true }).fill('0x7777777777777777777777777777777777777777');
    await page.getByLabel('Name', { exact: true }).fill('Jordan Lee');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  } else await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await page.getByRole('button', { name: /No, create one/ }).click();
  if (options.twoOwners) {
    await page.getByRole('checkbox', { name: /Jordan Lee/ }).check();
    await page.getByLabel('Approval threshold', { exact: true }).selectOption('2');
  }
  await page.getByLabel('Deposit into company account (USDC)').fill('10');
  await page.getByRole('button', { name: 'Review setup cost', exact: true }).click();
}
async function noSubmission(page: Page) {
  expect(await page.evaluate(() => sessionStorage.getItem('qa:submissions'))).toBeNull();
}
for (const theme of ['light', 'dark']) {
  test(`${theme}: rejecting setup preserves the exact deposit and fee without native gas`, async ({ page }, testInfo) => {
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.setViewportSize(theme === 'dark' ? { width: 390, height: 844 } : { width: 1440, height: 1100 });
    await start(page, 'declined');
    await expect(page.getByLabel('Setup review')).toContainText('10.025 USDC');
    await page.getByRole('button', { name: 'Confirm account setup', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Account setup cancelled. Your settings and deposit amount are saved.');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm account setup', exact: true })).toBeEnabled();
    await noSubmission(page);
    await expect(page.locator('body')).not.toContainText('Request Arguments');
    await expect(page.locator('body')).not.toContainText('viem@');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`setup-cancelled-${theme}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Edit setup', exact: true }).click();
    await expect(page.getByLabel('Deposit into company account (USDC)')).toHaveValue('10');
  });
}
for (const [scenario, message] of [
  ['insufficient', 'does not have enough USDC'],
  ['unavailable', 'service is busy'],
  ['malformed', 'does not match your instructions'],
] as const) {
  test(`${scenario}: stops before a wallet signature and preserves editable details`, async ({ page }) => {
    await start(page, scenario);
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByLabel('Deposit into company account (USDC)')).toHaveValue('10');
    await expect(page.getByRole('button', { name: 'Review setup cost', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => sessionStorage.getItem('qa:walletAttempts'))).toBeNull();
    await noSubmission(page);
  });
}
test('lost response persists the original operation through reload and never submits a replacement', async ({ page }) => {
  await start(page, 'unknown');
  await page.getByRole('button', { name: 'Confirm account setup', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('original request is saved');
  await page.reload();
  await page.getByRole('button', { name: /No, create one/ }).click();
  await expect(page.getByRole('button', { name: 'Check setup status', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Confirm account setup', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Confirmation is still pending' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('qa:submissions'))).toBe('1');
});
test('confirmed failure distinguishes the untouched deposit from the charged provider fee', async ({ page }) => {
  await start(page, 'reverted');
  await page.getByRole('button', { name: 'Confirm account setup', exact: true }).click();
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your deposit was not transferred. The provider charged 0.025 USDC');
  await expect(page.getByLabel('Deposit into company account (USDC)')).toHaveValue('10');
  await expect(page.getByRole('button', { name: 'Review setup cost', exact: true })).toBeEnabled();
});
test('only verified completion advances to the workspace', async ({ page }) => {
  await start(page, 'success');
  await page.getByRole('button', { name: 'Confirm account setup', exact: true }).click();
  await expect(page).toHaveURL(/onboarding/);
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(page).toHaveURL(/org\/demo\/dashboard/);
});
test('wallet change requires the original payer and never sends a transaction', async ({ page }) => {
  await start(page, 'wallet-changed');
  await page.getByRole('button', { name: 'Confirm account setup', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('connected wallet changed');
  await noSubmission(page);
});
test('expired quote cannot be authorized', async ({ page }) => {
  await page.clock.install();
  await start(page, 'expired-quote');
  await page.clock.fastForward(2000);
  await expect(page.getByRole('button', { name: 'Confirm account setup', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Refresh fee quote', exact: true })).toBeEnabled();
  await noSubmission(page);
});
test('failed persistence never reaches the execution provider', async ({ page }) => {
  await start(page, 'save-failed');
  await page.getByRole('button', { name: 'Confirm account setup', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('It was not sent to the execution service');
  await expect(page.getByLabel('Setup review')).toContainText('10.025 USDC');
  await noSubmission(page);
});
test('an RPC outage preserves the saved request, its fee and the retryable status check', async ({ page }) => {
  await start(page, 'check-outage');
  await page.getByRole('button', { name: 'Confirm account setup', exact: true }).click();
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your original request is saved');
  await expect(page.getByRole('button', { name: 'Check setup status', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Review setup cost', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('private-key');
  expect(await page.evaluate(() => sessionStorage.getItem('qa:submissions'))).toBe('1');
});

test('unreadable saved setup shows recovery instead of crashing or allowing another payment', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, 'unknown');
  await page.getByRole('button', { name: 'Confirm account setup', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('original request is saved');
  await page.evaluate(() => {
    const operation = JSON.parse(sessionStorage.getItem('qa:customerOperation')!);
    operation.record = '{unreadable provider diagnostics';
    sessionStorage.setItem('qa:customerOperation', JSON.stringify(operation));
  });
  await page.reload();
  await page.getByRole('button', { name: /No, create one/ }).click();
  await expect(page.getByRole('alert')).toContainText('saved setup details could not be read');
  await expect(page.getByRole('button', { name: 'Check setup status', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Review setup cost', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('provider diagnostics');
  expect(await page.evaluate(() => sessionStorage.getItem('qa:submissions'))).toBe('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('setup-recovery-unreadable.png'), fullPage: true });
});
test('a failed account link retains the confirmed deployment for recovery', async ({ page }) => {
  await start(page, 'link-failed');
  await page.getByRole('button', { name: 'Confirm account setup', exact: true }).click();
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(page).toHaveURL(/onboarding/);
  await expect(page.getByRole('button', { name: 'Check setup status', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Confirm account setup', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Your original request is saved');
  expect(await page.evaluate(() => sessionStorage.getItem('qa:submissions'))).toBe('1');
});
test('an expired unsubmitted request releases setup without inventing a provider charge', async ({ page }) => {
  await start(page, 'expired-request');
  await page.getByRole('button', { name: 'Confirm account setup', exact: true }).click();
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No provider fee was confirmed');
  await expect(page.getByLabel('Deposit into company account (USDC)')).toHaveValue('10');
  await expect(page.getByRole('button', { name: 'Review setup cost', exact: true })).toBeEnabled();
});
test('reload restores both account owners and the original approval threshold', async ({ page }) => {
  await start(page, 'unknown', { twoOwners: true });
  await page.getByRole('button', { name: 'Confirm account setup', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('original request is saved');
  await page.reload();
  await page.getByRole('button', { name: /No, create one/ }).click();
  await expect(page.getByLabel('Approval threshold', { exact: true })).toHaveValue('2');
  await expect(page.getByRole('checkbox', { name: /0x777777.*7777/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /0x777777.*7777/ })).toBeDisabled();
  await expect(page.getByLabel('Approval threshold', { exact: true })).toBeDisabled();
  expect(await page.evaluate(() => sessionStorage.getItem('qa:submissions'))).toBe('1');
});
