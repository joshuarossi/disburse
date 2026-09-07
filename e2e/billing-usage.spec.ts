import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) {
  test(`billing shows actual usage and accurate plan features in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    await page.goto('/org/demo/settings?tab=billing');
    const usage = page.getByRole('region', { name: 'Workspace usage' });
    await expect(usage).toContainText('4 of 5 used');
    await expect(usage).toContainText('2 active · 2 pending invitations');
    await expect(usage).toContainText('12 of 100 used');
    await expect(usage).toContainText('Includes 3 archived records');
    await expect(page.getByText('1 Safe per chain', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Separate business accounts', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Paid access ends', { exact: false })).toContainText('unused paid time');
    await usage.scrollIntoViewIfNeeded();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/qa/billing-usage-${theme}.png`, fullPage: true });
  });
}
test('the trial gives a clear end date without suggesting it has paid credit', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'billing-trial'));
  await page.goto('/org/demo/settings?tab=billing');
  await expect(page.getByText('Trial access ends', { exact: false })).toBeVisible();
  await expect(page.getByText('Unused trial days do not become paid credit.', { exact: false })).toBeVisible();
  await expect(page.getByText('This date includes any unused paid time.', { exact: false })).toHaveCount(0);
  await expect(page.getByText('After this period, Free access continues automatically.', { exact: false })).toBeVisible();
});
test('missing usage leaves renewal available and does not show a made-up zero', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'billing-usage-unavailable'));
  await page.goto('/org/demo/settings?tab=billing');
  await expect(page.getByRole('status')).toContainText('Usage could not be counted');
  await expect(page.getByRole('region', { name: 'Workspace usage' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Renew for 30 days' })).toBeEnabled();
});
test('Portuguese pricing preserves the USD amount and 30-day period', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('i18nextLng', 'pt-BR'));
  await page.goto('/org/demo/settings?tab=billing');
  await expect(page.getByText('US$ 50 / 30 dias', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Uso do espaço de trabalho' })).toContainText('4 de 5 em uso');
  await expect(page.getByText('R$ 50/mês', { exact: true })).toHaveCount(0);
});
