import { expect, test, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const languages = {
  en: { name: 'English', toLight: 'Switch to light theme', toDark: 'Switch to dark theme', cta: 'Try for free' },
  es: { name: 'Español', toLight: 'Cambiar al tema claro', toDark: 'Cambiar al tema oscuro', cta: 'Pruébalo gratis' },
  'pt-BR': { name: 'Português (Brasil)', toLight: 'Alterar para o tema claro', toDark: 'Alterar para o tema escuro', cta: 'Experimente grátis' },
};

async function expectControlsInViewport(header: Locator, width: number) {
  for (const control of await header.locator('a:visible, button:visible').all()) {
    const bounds = await control.boundingBox();
    expect(bounds, await control.innerText()).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  }
}

for (const width of [320, 390, 640, 768]) {
  for (const language of ['en', 'es', 'pt-BR'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`public header fits and works at ${width}px in ${language}/${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.addInitScript(({ language, theme }) => {
          localStorage.setItem('i18nextLng', language);
          localStorage.setItem('theme', theme);
        }, { language, theme });
        await page.goto('/docs');
        const header = page.getByRole('banner');
        const copy = languages[language];
        await expect(header.getByRole('link', { name: 'Disburse', exact: true })).toBeVisible();
        await expectControlsInViewport(header, width);

        const nextTheme = theme === 'light' ? 'dark' : 'light';
        await header.getByRole('button', { name: theme === 'light' ? copy.toDark : copy.toLight, exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', nextTheme);
        await expect(header.getByRole('button', { name: theme === 'light' ? copy.toLight : copy.toDark, exact: true })).toBeVisible();
        await expectControlsInViewport(header, width);

        await header.getByRole('button', { name: copy.name, exact: true }).click();
        await expectControlsInViewport(header, width);
        const nextLanguage = language === 'en' ? 'es' : 'en';
        await header.getByRole('button', { name: nextLanguage === 'es' ? '🇪🇸 Español' : '🇺🇸 English', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('lang', nextLanguage);
        await expectControlsInViewport(header, width);
        const accessibility = await new AxeBuilder({ page }).include('header').withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(accessibility.violations).toEqual([]);

        const signIn = header.getByRole('link', { name: languages[nextLanguage].cta, exact: true });
        await expect(signIn).toHaveAttribute('href', '/login');
        await signIn.click();
        await expect(page).toHaveURL(/\/login$/);
      });
    }
  }
}
