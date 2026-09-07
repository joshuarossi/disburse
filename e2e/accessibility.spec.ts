import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  "dashboard",
  "beneficiaries",
  "disbursements",
  "invoices",
  "payments",
  "treasury",
  "team",
  "settings",
  "settings?tab=safe",
  "settings?tab=fees",
  "settings?tab=security",
  "settings?tab=billing",
  "reports",
  "disbursements?new=1",
  "beneficiaries?import=1",
];
for (const theme of ["light", "dark"]) {
  for (const route of routes) {
    test(`${theme}: ${route} meets automated WCAG checks`, async ({ page }) => {
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      await page.goto(`/org/demo/${route}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

for (const route of routes) {
  test(`320px: ${route} contains its content`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`/org/demo/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const dialog of await page.getByRole("dialog").all()) {
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
  });
}

test("payment dialog traps focus and restores it to its trigger", async ({
  page,
}) => {
  await page.goto("/org/demo/disbursements");
  const trigger = page.getByRole("button", {
    name: "New payment",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 35; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const theme of ["light", "dark"]) {
  for (const [route, button] of [
    ["beneficiaries", "Add recipient"],
    ["invoices", "Add bill"],
    ["team", "Invite member"],
    ["team", "Edit Alex Morgan"],
    ["payments", "Edit"],
    ["settings?tab=safe", "Connect another account"],
  ]) {
    test(`${theme}: ${button} form has accessible controls`, async ({
      page,
    }) => {
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      await page.goto(`/org/demo/${route}`);
      await page.getByRole("button", { name: button, exact: true }).click();
      if (!route.startsWith("settings"))
        await expect(page.getByRole("dialog")).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const section of [
    "Transactions",
    "Spending by Beneficiary",
    "Audit Log",
  ]) {
    test(`${theme}: ${section} filters are accessible on mobile`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 740 });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      await page.goto("/org/demo/reports");
      await page
        .getByRole("navigation", { name: "Report sections" })
        .getByRole("button", { name: section, exact: true })
        .click();
      await page.getByRole("button", { name: /Filters/ }).click();
      await expect(page.getByLabel("Start date")).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}
