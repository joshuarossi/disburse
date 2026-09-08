import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

for (const [theme, width] of [
  ["light", 1440],
  ["dark", 390],
] as const) {
  test(`recipient-first payment shows fees and shortages in ${theme} at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript((theme) => {
      localStorage.setItem("theme", theme);
      sessionStorage.setItem("qa:scenario", "funding-shortfall");
    }, theme);
    await page.goto("/org/demo/disbursements?new=1");
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Who are you paying?" }),
    ).toBeVisible();
    await expect(dialog.getByLabel("Payment name")).toHaveCount(0);
    await dialog.getByRole("checkbox", { name: "Select Maya Chen" }).check();
    await dialog
      .getByLabel("Amount for Maya Chen", { exact: true })
      .fill("1.000001");
    const funding = dialog.getByRole("region", { name: "Base funding check" });
    await expect(funding).toContainText("Add 1.000001 USDC");
    await expect(funding).toContainText(
      "Keep additional USDC in this account for execution fees",
    );
    await expect(funding).toContainText("2 of 2 owners required");
    expect(
      (
        await new AxeBuilder({ page })
          .include("dialog")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `.local/qa/payment-recipients-${theme}.png`,
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Continue to timing" }).click();
    await expect(dialog.getByLabel("When to pay")).toHaveValue("now");
    await page.screenshot({
      path: `.local/qa/payment-timing-${theme}.png`,
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Review payment", exact: true })
      .click();
    await expect(funding).toContainText("Add 1.000001 USDC");
    await expect(
      dialog.getByRole("button", { name: "Save payment draft" }),
    ).toBeEnabled();
    await expect(dialog).toContainText("Saving does not move funds");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include("dialog")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `.local/qa/payment-review-${theme}.png`,
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      dialog.getByLabel("Amount for Maya Chen", { exact: true }),
    ).toHaveValue("1.000001");
  });
}

test("an unavailable funding check offers recovery without pretending the balance is zero", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "funding-outage"),
  );
  await page.goto("/org/demo/disbursements?new=1");
  const funding = page.getByRole("region", { name: "Base funding check" });
  await expect(funding).toContainText("The account check is unavailable");
  await expect(funding.getByText("0 USDC", { exact: true })).toHaveCount(0);
  await expect(
    funding.getByRole("button", { name: "Refresh Base funding check" }),
  ).toBeEnabled();
});

test("accounts use current balances and approvals, with a recoverable rename form", async ({
  page,
}) => {
  await page.goto("/org/demo/treasury");
  const account = page.getByRole("region", { name: "Base funding check" });
  await expect(account).toContainText("Operating account");
  await expect(account).toContainText("2 of 2 owners required");
  await expect(account).toContainText("148,250.50 USDC");
  await expect(account).toContainText("Alex Morgan · Jordan Lee");
  await account.getByRole("button", { name: "Add funds" }).click();
  const deposit = page.getByRole("dialog");
  await expect(deposit.getByLabel("Account address")).toHaveValue(
    /^0x[0-9a-fA-F]{40}$/,
  );
  await expect(deposit).toContainText("Use this network when withdrawing");
  await deposit.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/org/demo/settings?tab=safe");
  await page
    .getByRole("button", { name: "Rename", exact: true })
    .first()
    .click();
  const rename = page.getByRole("dialog");
  await rename.getByLabel("Account name").fill("Payroll account");
  await rename.getByRole("button", { name: "Save account name" }).click();
  await expect(rename.getByRole("alert")).toContainText("read-only");
  await expect(rename.getByLabel("Account name")).toHaveValue(
    "Payroll account",
  );
  await expect(
    rename.getByRole("button", { name: "Save account name" }),
  ).toBeEnabled();
});
