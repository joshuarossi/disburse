import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

async function accountSetup(page: Page, scenario: string) {
  await page.addInitScript(
    (value) => sessionStorage.setItem("qa:scenario", value),
    scenario,
  );
  await page.goto("/onboarding");
  await page.getByLabel("Name", { exact: true }).fill("Alex Morgan");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Organization name", { exact: true })
    .fill("Cancellation QA");
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await page.getByRole("button", { name: /No, create one/ }).click();
  await page.getByRole("button", { name: "Create Safe", exact: true }).click();
}

for (const theme of ["light", "dark"]) {
  test(`${theme}: declined account creation preserves settings and retries without raw wallet diagnostics`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.setViewportSize(
      theme === "dark"
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
    );
    await accountSetup(page, "onboarding-wallet-declined");
    await expect(page.getByRole("status")).toContainText(
      "Account creation cancelled. Your settings are saved here.",
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("Chain", { exact: true })).toHaveValue("8453");
    await expect(
      page.getByRole("button", { name: "Create Safe", exact: true }),
    ).toBeEnabled();
    const before = await page.evaluate(() =>
      sessionStorage.getItem("qa:safeCreation"),
    );
    await page
      .getByRole("button", { name: "Create Safe", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem("qa:walletAttempts")),
      )
      .toBe("2");
    expect(
      await page.evaluate(() => sessionStorage.getItem("qa:safeCreation")),
    ).toBe(before);
    await expect(page.locator("body")).not.toContainText("Request Arguments");
    await expect(page.locator("body")).not.toContainText("viem@");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`account-cancelled-${theme}.png`),
      fullPage: true,
    });
  });
}

test("unknown account-creation response keeps the predicted address and asks for settlement checking", async ({
  page,
}) => {
  await accountSetup(page, "onboarding-wallet-unknown");
  await expect(page.getByRole("alert")).toContainText(
    "did not confirm whether account creation was submitted",
  );
  await expect(page.getByLabel("Safe address", { exact: true })).toHaveValue(
    "0x1111111111111111111111111111111111111111",
  );
  await expect(
    page.getByRole("button", { name: "Create Safe", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:walletAttempts")),
  ).toBe("1");
});

test("an archived recipient can be explicitly removed from a draft without changing the other amount", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "draft-archived-recipient"),
  );
  await page.goto("/org/demo/disbursements?focus=p1");
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText(
    "Maya Chen is archived or unavailable",
  );
  const amount = await dialog
    .getByLabel("Amount for James Okafor", { exact: true })
    .inputValue();
  await dialog
    .getByRole("button", { name: "Remove unavailable recipient", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Amount for James Okafor", { exact: true }),
  ).toHaveValue(amount);
  await dialog
    .getByRole("button", { name: "Continue to timing", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Payment name", { exact: true }),
  ).toBeVisible();
});

test("an invoice draft keeps its details while replacing an archived receiving account", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "ar-archived-account"),
  );
  await page.goto("/org/demo/receivables");
  await page
    .getByRole("button", { name: "INV-2026-1043", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "saved receiving account is archived",
  );
  const originalCurrency = await page
    .getByRole("combobox", { name: "Invoice currency", exact: true })
    .inputValue();
  await page
    .getByRole("combobox", { name: "Receive into", exact: true })
    .selectOption("safe1");
  await expect(
    page.getByRole("combobox", { name: "Invoice currency", exact: true }),
  ).toHaveValue(originalCurrency);
  await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
    "Cedar Partners",
  );
  await expect(page.getByLabel("Invoice number", { exact: true })).toHaveValue(
    "INV-2026-1043",
  );
  await expect(page.getByLabel("Unit price 1", { exact: true })).toHaveValue(
    "2000",
  );
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeEnabled();
});
