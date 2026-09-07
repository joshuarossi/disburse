import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "report-observed"),
  );
});
for (const [theme, width] of [
  ["light", 1440],
  ["dark", 390],
] as const) {
  test(`currency and unrecognized-asset filters remain distinct in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await page.goto("/org/demo/reports");
    await page.getByRole("button", { name: /^Filters/ }).click();
    const currency = page.getByRole("button", { name: "USDC", exact: true });
    await expect(
      page.getByRole("button", { name: "PYUSD", exact: true }),
    ).toBeVisible();
    await currency.click();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await expect(currency).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("Unrecognized deposit", { exact: true }),
    ).toHaveCount(0);
    const select = page.getByRole("combobox", {
      name: "Other received assets",
    });
    const option = await select.locator("option").allTextContents();
    expect(option.some((text) => text.includes("USDC · Base · 0x"))).toBe(true);
    const value = await select.locator("option").nth(1).getAttribute("value");
    await select.selectOption(value!);
    await expect(currency).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByText("Business deposit", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Unrecognized deposit", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByText(/\$60,000/)).toHaveCount(0);
    await expect(page.getByText(/^60,000/).filter({ visible: true })).toBeVisible();
    await expect(
      page.getByText("Currency filters use supported assets.", {
        exact: false,
      }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await select.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.local/qa/observed-assets-${theme}.png`,
      fullPage: true,
    });
    await page
      .getByRole("combobox", { name: "Activity environment" })
      .selectOption("test");
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(select).toHaveValue("");
    await expect(
      page.getByText("Test deposit", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
  });
}
