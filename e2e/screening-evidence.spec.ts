import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});
for (const [theme, width] of [
  ["light", 1440],
  ["dark", 390],
] as const) {
  test(`screening evidence distinguishes names and exact address-network evidence in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await page.goto("/org/demo/beneficiaries");
    await page.getByRole("button", { name: "Maya Chen", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("OFAC screening", { exact: true }).click();
    await expect(
      dialog.getByText("Match needs review", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText(/SDN ID 123.*Weak alias/)).toBeVisible();
    await expect(
      dialog.getByText(/identifier is listed for a different network/),
    ).toBeVisible();
    await dialog.getByText("Details checked", { exact: true }).click();
    await expect(
      dialog
        .getByText("0x5555555555555555555555555555555555555555", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await dialog.getByText("OFAC source and version", { exact: true }).click();
    await expect(
      dialog.getByText("a".repeat(64), { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Mark false positive" }),
    ).toBeDisabled();
    await dialog
      .getByLabel("Review reason")
      .fill(
        "Reviewed the supplier registration and established contact records.",
      );
    await dialog
      .getByRole("checkbox", {
        name: /I reviewed the current recipient details/,
      })
      .check();
    await expect(
      dialog.getByRole("button", { name: "Mark false positive" }),
    ).toBeEnabled();
    expect(
      (
        await new AxeBuilder({ page })
          .include("dialog")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await dialog
      .getByRole("heading", { name: /Listed evidence/ })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.local/qa/screening-evidence-${theme}.png`,
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Mark false positive" }).click();
    await expect(dialog.getByRole("alert")).toContainText("read-only");
  });
}
test("stale evidence cannot be dismissed and a failed rerun stays visible", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "screening-stale"),
  );
  await page.goto("/org/demo/beneficiaries");
  await page.getByRole("button", { name: "Maya Chen", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("OFAC screening", { exact: true }).click();
  await expect(
    dialog.getByText("Check out of date", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Mark false positive" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Run screening" }).click();
  await expect(dialog.getByRole("alert")).toContainText("read-only");
});
test("an exact listed-network identifier cannot be dismissed as a name false positive", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "screening-exact"),
  );
  await page.goto("/org/demo/beneficiaries");
  await page.getByRole("button", { name: "Maya Chen", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("OFAC screening", { exact: true }).click();
  await dialog
    .getByLabel("Review reason")
    .fill("Name-only override must not override the listed identifier.");
  await dialog
    .getByRole("checkbox", { name: /I reviewed the current recipient details/ })
    .check();
  await expect(
    dialog.getByRole("button", { name: "Mark false positive" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Confirm match" }),
  ).toBeEnabled();
});
test("settings shows actual source coverage, freshness policy and refresh errors", async ({
  page,
}) => {
  await page.goto("/org/demo/settings?tab=security");
  const source = page.getByRole("region", {
    name: "Screening data and freshness",
  });
  await expect(source).toBeVisible();
  await expect(source).toContainText("19,329 records");
  await expect(source).toContainText("1,007 published currency identifiers");
  await expect(source.getByLabel("Screening freshness limit")).toHaveValue(
    "24",
  );
  await source.getByRole("button", { name: "Refresh OFAC list" }).click();
  await expect(source.getByRole("alert")).toContainText("read-only");
});
