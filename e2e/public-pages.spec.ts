import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [390, 1440]) {
  for (const route of ['/', '/docs']) {
    test(`public ${route} at ${width}px has usable navigation and accessible content`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('a button, button a')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('opacity', '1');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

test('public billing terms match manual renewal and help explains recovery', async ({ page }) => {
  await page.goto('/terms');
  await expect(page.getByText(/do not renew automatically/)).toBeVisible();
  await page.goto('/docs');
  await page.getByRole('navigation', { name: 'Help topics' }).getByRole('link', { name: 'Resolve a payment needing attention' }).click();
  await expect(page).toHaveURL(/#recovery$/);
  await expect(page.getByRole('heading', { name: 'Resolve a payment needing attention' })).toBeVisible();
});

for (const theme of ['light', 'dark']) {
  test(`public trial call to action stays readable in ${theme} mode`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    await page.goto('/');
    const cta = page.locator('.marketing-cta');
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toHaveCSS('opacity', '1');
    const results = await new AxeBuilder({ page }).include('.marketing-cta').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  });
}
