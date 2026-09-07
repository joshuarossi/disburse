import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

test("business reports exclude test activity and unverified tokens; exports preserve their identity", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "report-environments"),
  );
  await page.goto("/org/demo/reports");
  await expect(
    page.getByRole("combobox", { name: "Activity environment" }),
  ).toHaveValue("production");
  await expect(
    page.getByRole("row").filter({ hasText: "Business deposit" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Test deposit" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Unrecognized deposit" }),
  ).toContainText("Unverified · excluded");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export all matches/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("production");
  const chunks = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain("Token contract");
  expect(csv).toContain("Funding account");
  expect(csv).toContain("1250.000001");
  expect(csv).not.toContain("900000");
  await page
    .getByRole("combobox", { name: "Activity environment" })
    .selectOption("test");
  await expect(
    page.getByRole("row").filter({ hasText: "Test deposit" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Business deposit" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Activity environment" }),
  ).toHaveValue("test");
  await page
    .getByRole("combobox", { name: "Activity environment" })
    .selectOption("unclassified");
  await expect(
    page.getByRole("row").filter({ hasText: "Unrecognized deposit" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Test deposit" }),
  ).toHaveCount(0);
});

test("a failed Team download leaves navigation usable and reload recovers it", async ({
  page,
}) => {
  await page.route("**/src/pages/Team.tsx*", (route) => route.abort());
  await page.goto("/org/demo/team");
  await expect(
    page.getByRole("heading", { name: "This page could not load" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "could not be downloaded",
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Reports", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reports", exact: true }),
  ).toBeVisible();
  await page.unroute("**/src/pages/Team.tsx*");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Team & approvals" })
    .click();
  await page.getByRole("button", { name: "Reload page" }).click();
  await expect(
    page.getByRole("heading", { name: "Team & approvals" }),
  ).toBeVisible();
  for (const name of ["Payment limits", "Delegated spending", "Members"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("heading", { name: "This page could not load" }),
    ).toHaveCount(0);
  }
});

for (const theme of ["light", "dark"])
  test(`${theme} report environment controls fit on mobile and remain accessible`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/org/demo/reports");
    await page
      .getByRole("combobox", { name: "Activity environment" })
      .selectOption("test");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .include(".workspace")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
  });

test("interrupted proposal preparation offers recovery and keeps the signed payment locked", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "proposal-recovery"),
  );
  await page.goto("/org/demo/disbursements?focus=p1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Your signed proposal is saved/)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Resume preparation", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Review in wallet", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Edit draft", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    dialog.getByRole("button", { name: "Resume preparation", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Resume preparation", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "disabled in visual QA",
  );
});

for (const width of [320, 390, 757, 900, 1024, 1440])
  test(`all header actions are fully visible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/org/demo/reports");
    for (const locator of [
      page.getByRole("combobox", { name: "Activity environment" }),
      page.getByRole("link", { name: "New payment", exact: true }),
      page.getByRole("button", { name: /Switch to .* theme/ }),
      page.getByRole("button", { name: /^Payment reminders/ }),
    ]) {
      await expect(locator).toBeVisible();
      const box = (await locator.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
  });

for (const theme of ["light", "dark"])
  test(`${theme} native recovery survives reload and checks the original submission`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      sessionStorage.setItem("qa:scenario", "native-recovery");
      localStorage.setItem("theme", value);
    }, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/org/demo/disbursements?focus=p1");
    await page.reload();
    const recovery = page.getByRole("region", { name: "Payment recovery" });
    await expect(recovery).toContainText(
      "checking whether your approved payment settled",
    );
    await expect(
      recovery.getByRole("button", { name: "Check settlement" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Review in wallet", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Resume payment", exact: true }),
    ).toHaveCount(0);
    await recovery.getByRole("button", { name: "Check settlement" }).click();
    await expect(recovery.getByRole("status")).toContainText("read-only");
    const audit = await new AxeBuilder({ page })
      .include('dialog')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await recovery.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/qa/screenshots/v2-native-recovery-${theme}.png` });
  });
