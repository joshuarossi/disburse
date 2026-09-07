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
  test(`overview separates approvals, exceptions and drafts in ${theme} at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await page.goto("/org/demo/dashboard");
    const exceptions = page.getByRole("region", { name: "Payment exceptions" });
    const drafts = page.getByRole("region", { name: "Payment drafts" });
    await expect(exceptions).toContainText("Cloud infrastructure");
    await expect(exceptions).not.toContainText("September contractor payroll");
    await expect(drafts).toContainText("September contractor payroll");
    await expect(page.getByTestId("overview-payment-cards")).not.toContainText(
      "Cloud infrastructure",
    );
    await expect(
      page.getByText("Reviewed recipients", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("$101,150.50", { exact: true })).toBeVisible();
    await expect(page.getByText(/Funds are not reserved/)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: `.local/qa/overview-queues-${theme}.png`,
      fullPage: true,
    });
    await drafts
      .getByRole("link", { name: "View drafts", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Drafts", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  });
}

test("a schedule shows its next draft and links to its generated payments", async ({
  page,
}) => {
  await page.goto("/org/demo/payments");
  await expect(
    page.getByRole("heading", { name: "Schedules", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Batch history" })).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: "Contractor payroll" });
  await expect(row).toContainText("Oct 12");
  await expect(row).toContainText("Oct 15");
  await expect(row).toContainText("Alex Morgan");
  await row
    .getByRole("link", { name: "Review latest payment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/org/demo/payments");
  await row.getByRole("link", { name: "Payment history", exact: true }).click();
  await expect(page).toHaveURL(/schedule=rec1/);
  await expect(
    page.getByText("September contractor payroll", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Product studio · September", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Show all payments" }).click();
  await expect(
    page.getByText("Product studio · September", { exact: true }),
  ).toBeVisible();
});
