import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const token = "ab".repeat(32);
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
  test(`recipient supplies and reviews exact payment instructions in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await page.goto(`/recipient-details#${token}`);
    await expect(
      page.getByRole("heading", { name: "Where should we pay you?" }),
    ).toBeVisible();
    await expect(page.getByText("Request from Northstar Studio")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Connect wallet|Sign in/ }),
    ).toHaveCount(0);
    await page.getByLabel("Payment network").selectOption("8453");
    await page.getByLabel("Payment currency").selectOption("USDC");
    await page.getByLabel("Receiving address").fill("invalid");
    await page.getByRole("button", { name: "Review payment details" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid address");
    await page
      .getByLabel("Receiving address")
      .fill("0x2222222222222222222222222222222222222222");
    await page.getByRole("button", { name: "Review payment details" }).click();
    await expect(
      page.getByRole("heading", { name: "Confirm your payment details" }),
    ).toBeVisible();
    await expect(
      page.getByText("0x2222222222222222222222222222222222222222", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send details", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Edit details" }).click();
    await expect(page.getByLabel("Receiving address")).toHaveValue(
      "0x2222222222222222222222222222222222222222",
    );
    await expect(page.getByLabel("Payment currency")).toHaveValue("USDC");
    await page.getByRole("button", { name: "Review payment details" }).click();
    await page.getByRole("checkbox").check();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/qa/recipient-collection-${theme}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Send details", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("read-only");
    await expect(
      page.getByRole("button", { name: "Send details", exact: true }),
    ).toBeEnabled();
  });
}

test("public receipts survive reload and inactive links disclose no recipient details", async ({
  page,
}) => {
  for (const [scenario, heading] of [
    ["collection-received", "Your details have been received"],
    ["collection-approved", "Payment details approved"],
    ["collection-expired", "This link has expired"],
  ]) {
    await page.addInitScript(
      (scenario) => sessionStorage.setItem("qa:scenario", scenario),
      scenario,
    );
    await page.goto(`/recipient-details#${token}`);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send details", exact: true }),
    ).toHaveCount(0);
  }
  await expect(page.getByText(/Maya Chen|Northstar Studio/)).toHaveCount(0);
  await page.goto("/recipient-details#unknown");
  await expect(
    page.getByRole("heading", { name: "This link is unavailable" }),
  ).toBeVisible();
});

test("finance team can see a pending request, its expiry and recovery actions", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "collection-requested"),
  );
  await page.goto("/org/demo/beneficiaries");
  await page.getByRole("button", { name: "Maya Chen", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Awaiting details/)).toBeVisible();
  await expect(dialog.getByText(/Expires/)).toBeVisible();
  await dialog.getByRole("button", { name: "Revoke link" }).click();
  await expect(dialog.getByRole("alert")).toContainText("read-only");
  await expect(
    dialog.getByRole("button", { name: "Replace link" }),
  ).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Copy link" })).toHaveCount(
    0,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .include("dialog")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
