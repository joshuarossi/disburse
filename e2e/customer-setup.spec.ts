import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
async function start(page: Page, scenario: string, twoOwners = false) {
  await page.addInitScript(value => sessionStorage.setItem('qa:scenario', value), `customer-setup-${scenario}`);
  await page.goto('/onboarding');
  await page.getByLabel('Name', { exact: true }).fill('Alex Morgan');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Organization name', { exact: true }).fill('Setup QA');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  if (twoOwners) {
    await page.getByRole('button', { name: 'Add a team member', exact: true }).click();
    await page.getByLabel('Wallet address *', { exact: true }).fill('0x7777777777777777777777777777777777777777');
    await page.getByLabel('Name', { exact: true }).fill('Jordan Lee');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  } else await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await page.getByRole('button', { name: /Create a company account/ }).click();
  await page.getByLabel('Payment network', { exact: true }).selectOption('8453');
  if (twoOwners) {
    await page.getByRole('checkbox', { name: /Jordan Lee/ }).check();
    await page.getByLabel('Approvals required', { exact: true }).selectOption('2');
  }
  await page.getByLabel('Deposit into company account (USDC)').fill('10');
  await page.getByRole('button', { name: 'Review setup', exact: true }).click();
}
async function confirm(page: Page) {
  await page.getByRole('checkbox', { name: /I will review and pay the setup fee in USDC/ }).check();
  await page.getByRole('button', { name: 'Confirm setup in MetaMask', exact: true }).click();
}
async function noSubmission(page: Page) { expect(await page.evaluate(() => sessionStorage.getItem('qa:submissions'))).toBeNull(); }
for (const theme of ['light', 'dark']) {
  test(`${theme}: rejecting setup preserves the deposit and shows a neutral notice`, async ({ page }, testInfo) => {
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.setViewportSize(theme === 'dark' ? { width: 390, height: 844 } : { width: 1440, height: 1100 });
    await start(page, 'declined');
    await expect(page.getByLabel('Setup review')).toContainText('10 USDC');
    await expect(page.getByLabel('Setup review')).toContainText('Review in MetaMask');
    await confirm(page);
    await expect(page.getByRole('status')).toContainText('Wallet confirmation cancelled');
    await expect(page.getByRole('alert')).toHaveCount(0);
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
for (const [scenario, message] of [['insufficient', 'wallet needs enough USDC'], ['unavailable', 'Could not complete account setup']] as const) {
  test(`${scenario}: stops before the wallet and keeps editable details`, async ({ page }) => {
    await start(page, scenario);
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByLabel('Deposit into company account (USDC)')).toHaveValue('10');
    await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => sessionStorage.getItem('qa:walletAttempts'))).toBeNull(); await noSubmission(page);
  });
}
test('lost wallet response survives reload without submitting another batch', async ({ page }) => {
  await start(page, 'unknown'); await confirm(page);
  await expect(page.getByRole('alert')).toContainText('original setup request is saved');
  await page.reload(); await page.getByRole('button', { name: /Create a company account/ }).click();
  await expect(page.getByRole('button', { name: 'Check setup status', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Confirm setup in MetaMask', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('still processing the original request');
  expect(await page.evaluate(() => sessionStorage.getItem('qa:submissions'))).toBe('1');
});
test('a matched reverted receipt keeps the deposit and requires fresh fee consent', async ({ page }) => {
  await start(page, 'reverted'); await confirm(page);
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your deposit was not transferred');
  await expect(page.getByRole('alert')).toContainText('Check MetaMask for any execution fee');
  await expect(page.getByRole('button', { name: 'Confirm setup in MetaMask', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Setup review')).toContainText('10 USDC');
});
test('only server-verified completion opens the workspace', async ({ page }) => {
  await start(page, 'success'); await confirm(page); await expect(page).toHaveURL(/onboarding/);
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(page).toHaveURL(/org\/demo\/dashboard/);
});
for (const [scenario, message] of [['wallet-changed', 'wallet or network changed'], ['unsupported-wallet', 'wallet cannot create and fund'], ['owners-changed', 'owners can no longer approve']] as const) {
  test(`${scenario}: preserves the saved setup without a wallet submission`, async ({ page }) => {
    await start(page, scenario); await confirm(page);
    await expect(page.getByRole('alert')).toContainText(message); await noSubmission(page);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa:walletSetup')!).stage)).toBe('prepared');
  });
}
test('failed persistence stops before opening a wallet confirmation', async ({ page }) => {
  await start(page, 'save-failed'); await confirm(page);
  await expect(page.getByRole('alert')).toContainText('Could not save the setup request');
  expect(await page.evaluate(() => sessionStorage.getItem('qa:walletAttempts'))).toBeNull(); await noSubmission(page);
});
for (const scenario of ['claim-response-lost', 'decline-save-failed']) {
  test(`${scenario}: restores the original deposit after reload without another wallet request`, async ({ page }) => {
    await start(page, scenario); await confirm(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await page.reload(); await page.getByRole('button', { name: /Create a company account/ }).click();
    await expect(page.getByRole('button', { name: 'Restore saved setup', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Restore saved setup', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('No new wallet request was submitted');
    await expect(page.getByLabel('Setup review')).toContainText('10 USDC');
    await expect(page.getByRole('button', { name: 'Confirm setup in MetaMask', exact: true })).toBeDisabled();
    await noSubmission(page);
    expect(await page.evaluate(() => sessionStorage.getItem('qa:walletAttempts'))).toBe(scenario === 'claim-response-lost' ? null : '1');
  });
}
test('a lost completion response restores the connected account instead of offering another deposit', async ({ page }) => {
  await start(page, 'complete-response-lost'); await confirm(page);
  await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: /Create a company account/ }).click();
  await expect(page.getByRole('button', { name: 'Open company account', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open company account', exact: true }).click();
  await expect(page).toHaveURL(/org\/demo\/dashboard/);
  expect(await page.evaluate(() => sessionStorage.getItem('qa:submissions'))).toBe('1');
});
test('unavailable site storage stops setup before a wallet request', async ({ page }) => {
  await start(page, 'success');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('disburse:wallet-setup:')) throw new DOMException('Storage unavailable', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await confirm(page);
  await expect(page.getByRole('alert')).toContainText('Allow site storage');
  await noSubmission(page);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa:walletSetup')!).stage)).toBe('prepared');
});
for (const scenario of ['check-outage', 'malformed-status', 'link-failed']) {
  test(`${scenario}: keeps the original request available for another check`, async ({ page }) => {
    await start(page, scenario); await confirm(page);
    await page.getByRole('button', { name: 'Check setup status', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check setup status', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Confirm setup in MetaMask', exact: true })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('rpc.invalid');
    expect(await page.evaluate(() => sessionStorage.getItem('qa:submissions'))).toBe('1');
  });
}
test('reload restores the original owners, threshold and network', async ({ page }) => {
  await start(page, 'unknown', true); await confirm(page);
  await expect(page.getByRole('alert')).toContainText('original setup request is saved');
  await page.reload(); await page.getByRole('button', { name: /Create a company account/ }).click();
  await expect(page.getByLabel('Approvals required', { exact: true })).toHaveValue('2');
  await expect(page.getByRole('checkbox', { name: /0x777777.*7777/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /0x777777.*7777/ })).toBeDisabled();
  await expect(page.getByLabel('Approvals required', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Payment network', { exact: true })).toHaveValue('8453');
  expect(await page.evaluate(() => sessionStorage.getItem('qa:submissions'))).toBe('1');
});
test('testnets never open an unsupported MetaMask fee request', async ({ page }) => {
  await start(page, 'declined'); await page.getByRole('button', { name: 'Edit setup', exact: true }).click();
  await page.getByLabel('Payment network', { exact: true }).selectOption('84532');
  await expect(page.getByRole('status')).toContainText('not available on testnets');
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeDisabled(); await noSubmission(page);
});
test('another administrator sees the original owner and cannot submit that wallet’s setup', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('qa:scenario', 'customer-setup-different-payer');
    sessionStorage.setItem('qa:walletSetup', JSON.stringify({ _id: 'wallet-setup1', orgId: 'demo', payer: '0x2222222222222222222222222222222222222222', owners: ['0x2222222222222222222222222222222222222222'], threshold: 1, chainId: 8453, deposit: '10000000', stage: 'prepared', open: true, batchId: '0x' + 'ab'.repeat(32) }));
  });
  await page.goto('/onboarding?org=demo');
  await page.getByRole('button', { name: /Create a company account/ }).click();
  await expect(page.getByText('0x222222...2222', { exact: true })).toBeVisible();
  await expect(page.getByText('(setup owner)', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Reconnect the wallet');
  await page.getByRole('checkbox', { name: /I will review and pay/ }).check();
  await expect(page.getByRole('button', { name: 'Confirm setup in MetaMask', exact: true })).toBeDisabled();
  await noSubmission(page);
});
