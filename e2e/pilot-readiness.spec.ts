import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

for (const width of [390, 1440]) {
  test(`all 50 payroll recipients remain in the main review flow at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'payroll-review-50'));
    await page.goto('/org/demo/disbursements?new=1');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Select recipients to see a total')).toBeVisible();
    await expect(dialog.locator('.sticky.bottom-0').getByText(/USDT/)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Select all 50 matching recipients' }).click();
    await dialog.getByLabel('Amount for all recipients', { exact: true }).fill('10');
    await dialog.getByRole('button', { name: 'Apply to selected' }).click();
    await dialog.getByRole('button', { name: 'Continue to timing' }).click();
    await dialog.getByRole('button', { name: 'Review payment', exact: true }).click();
    await expect(dialog.getByText('Review all 50 recipients below, including each payout address and amount.')).toBeVisible();
    const review = width < 640 ? dialog.getByRole('list', { name: 'Recipient payout review' }) : dialog.locator('table');
    const rows = width < 640 ? review.getByRole('listitem') : review.locator('tbody tr');
    await expect(rows).toHaveCount(50);
    // No intermediate scroll box may hide the rest of the recipient list.
    expect(await review.evaluate(element => {
      for (let parent = element.parentElement; parent && parent.tagName !== 'DIALOG'; parent = parent.parentElement) {
        if (parent.scrollHeight > parent.clientHeight && /auto|scroll|hidden/.test(getComputedStyle(parent).overflowY)) return false;
      }
      return true;
    })).toBe(true);
    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows.last()).toBeInViewport();
    await expect(rows.last()).toContainText('Payroll recipient 50');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`payroll-review-${width}.png`) });
  });
}

for (const theme of ['light', 'dark']) {
  test(`entry and reports use the workspace design in ${theme} mode`, async ({ page }, testInfo) => {
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.setViewportSize({ width: theme === 'light' ? 1440 : 390, height: 900 });
    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { name: 'Welcome to Disburse' })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`onboarding-${theme}.png`), fullPage: true });
    await page.goto('/org/demo/reports');
    await expect(page.locator('.workspace-status:visible').filter({ hasText: /^Paid$/ }).first()).toBeVisible();
    await expect(page.getByText('Executed', { exact: true })).toHaveCount(0);
    const address = page.getByText('0x5555555555555555555555555555555555555555', { exact: true });
    for (const element of await address.all()) await expect(element).not.toBeVisible();
    const details = page.locator('details:visible').filter({ has: page.getByText('Wallet address', { exact: true }) }).first();
    await details.locator('summary').click();
    await expect(details).toContainText('0x5555555555555555555555555555555555555555');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`reports-${theme}.png`), fullPage: true });
  });
}
