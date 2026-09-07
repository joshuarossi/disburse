import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) {
  test(`reminder review and schedule ownership in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => { localStorage.setItem('theme', theme); sessionStorage.setItem('qa:scenario', 'reminders'); }, theme);
    await page.goto('/org/demo/dashboard');
    await page.getByRole('button', { name: /Payment reminders · 2 unread/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Payment reminders' });
    await expect(dialog.getByRole('article')).toHaveCount(2);
    await expect(dialog).toContainText('delivered here in the app');
    await expect(dialog).toContainText('no catch-up payment is sent automatically');
    await dialog.getByLabel('Assigned to me').uncheck();
    await expect(dialog.getByRole('article')).toHaveCount(3);
    await dialog.getByLabel('Assigned to me').check();
    expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `.local/qa/payment-reminders-${theme}.png`, fullPage: true });
    await dialog.getByRole('link', { name: 'Review schedule', exact: true }).click();
    await expect(page).toHaveURL(/payments\?focus=rec1$/);
    const schedule = page.getByRole('dialog', { name: 'Contractor payroll' });
    await expect(schedule.getByRole('region', { name: 'Next occurrence' })).toContainText('Payment access needs attention');
    await expect(schedule.getByRole('region', { name: 'Latest prepared payment' })).toContainText('Approval deadline missed');
    const approvers = schedule.getByRole('region', { name: 'Responsible approvers' });
    await expect(approvers).toContainText('requires 2 of 2 owner approvals');
    await expect(approvers).toContainText('Jordan Lee');
    await expect(approvers.getByRole('listitem')).toHaveCount(2);
    expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await schedule.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: `.local/qa/schedule-details-${theme}.png`, fullPage: true });
    await approvers.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/qa/schedule-approvers-${theme}.png`, fullPage: true });
    await schedule.getByRole('link', { name: 'Review this payment', exact: true }).click();
    await expect(page).toHaveURL(/disbursements\?focus=p1$/);
    await expect(page.getByRole('dialog')).toBeVisible();
  });
}
test('a failed read acknowledgement keeps the reminder and payment available', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'reminders'));
  await page.goto('/org/demo/dashboard');
  await page.getByRole('button', { name: /Payment reminders/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Mark read', exact: true }).first().click();
  await expect(dialog.getByRole('alert')).toContainText('Your payment was not changed');
  await expect(dialog.getByRole('button', { name: 'Mark read', exact: true })).toHaveCount(2);
  await expect(dialog.getByRole('link', { name: 'Review payment', exact: true })).toBeVisible();
});
test('pagination has an honest empty page and returns to the latest reminders', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'reminders-paged'));
  await page.goto('/org/demo/dashboard');
  await page.getByRole('button', { name: /Payment reminders/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Older reminders', exact: true }).click();
  await expect(dialog).toContainText('No matching reminders on this page.');
  await expect(dialog.getByRole('article')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Back to latest', exact: true }).click();
  await expect(dialog.getByRole('article')).toHaveCount(2);
});
test('reminder service failure keeps normal navigation available', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'reminders-outage'));
  await page.goto('/org/demo/dashboard');
  await expect(page.getByRole('button', { name: 'Retry loading payment reminders', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Recipients', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recipients', exact: true })).toBeVisible();
});
test('unverified account approvers do not appear as an authoritative owner list', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'funding-outage'));
  await page.goto('/org/demo/payments?focus=rec1');
  const region = page.getByRole('region', { name: 'Responsible approvers' });
  await expect(region.getByRole('alert')).toContainText('Current account approvers could not be verified');
  await expect(region.getByRole('listitem')).toHaveCount(0);
  await expect(region.getByRole('button', { name: 'Refresh approvers', exact: true })).toBeEnabled();
});
test('unavailable schedule links explain the selected activity', async ({ page }) => {
  await page.goto('/org/demo/payments?focus=unknown-schedule');
  await expect(page.getByRole('alert')).toContainText('not available in the selected activity');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page).toHaveURL(/\/payments$/);
});
