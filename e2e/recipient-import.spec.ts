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
  test(`repeat import previews create, update and skip with reviewed payout changes in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await page.goto("/org/demo/beneficiaries?import=1");
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Source system for employee or vendor IDs")
      .selectOption("gusto");
    await dialog.locator("input[type=file]").setInputFiles({
      name: "gusto-employees.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Employee ID,Name,Email,Payment address,Currency,Network\n0012,Maya Chen,maya@northstar.co,0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,USDT,Base\n,James Okafor,james@northstar.co,,,\n0013,Jamie Rivera,jamie@example.com,,,",
      ),
    });
    const maya = dialog.getByRole("row").filter({ hasText: "Maya Chen" });
    const james = dialog.getByRole("row").filter({ hasText: "James Okafor" });
    const jamie = dialog.getByRole("row").filter({ hasText: "Jamie Rivera" });
    await expect(maya).toContainText("Update existing");
    await expect(james).toContainText("Skip");
    await expect(james.getByRole("checkbox")).toBeDisabled();
    await expect(jamie).toContainText("Create recipient");
    await expect(jamie).toContainText("Payment details needed");
    await maya.getByText(/Review \d+ changes/).click();
    const changes = dialog.getByRole("region", {
      name: "Changes for Maya Chen",
    });
    await expect(changes).toContainText(
      "Saved: 0x5555555555555555555555555555555555555555",
    );
    await expect(changes).toContainText(
      "Imported: 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    await expect(changes).toContainText("Payout review required");
    await expect(maya).toContainText("gusto · 0012");
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
      path: `.local/qa/recipient-import-${theme}.png`,
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Apply 2 changes" }).click();
    await expect(dialog.getByRole("alert")).toContainText("read-only");
    await expect(
      dialog.getByRole("button", { name: "Apply 2 changes" }),
    ).toBeEnabled();
  });
}

test("duplicate source identifiers remain visible and cannot be imported", async ({
  page,
}) => {
  await page.goto("/org/demo/beneficiaries?import=1");
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=file]").setInputFiles({
    name: "duplicate.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Employee ID,Name,Email\n0013,Jamie Rivera,jamie@example.com\n0013,Taylor Rivera,taylor@example.com",
    ),
  });
  await expect(
    dialog.getByText("Duplicate source ID, email or address in this file"),
  ).toHaveCount(2);
  await expect(
    dialog.getByRole("button", { name: "Apply 0 changes" }),
  ).toBeDisabled();
});

test("a saved import is recovered after reload without uploading or importing it again", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("qa:scenario", "import-recovered");
    sessionStorage.setItem(
      "disburse:recipient-import:demo",
      JSON.stringify({
        requestId: "recovered-import-request",
        hash: "known",
        skipped: 1,
      }),
    );
  });
  await page.goto("/org/demo/beneficiaries?import=1");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  await expect(dialog).toContainText("2 created · 1 updated · 1 skipped");
  await expect(dialog).toContainText("1 payout record needs review");
  await expect(dialog.locator("input[type=file]")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("disburse:recipient-import:demo"),
    ),
  ).toBeNull();
});
