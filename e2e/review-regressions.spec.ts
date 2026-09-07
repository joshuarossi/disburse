import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
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

for (const scenario of ['native-failed', 'relay-failed']) {
  test(`${scenario}: a confirmed execution failure explains what happened without offering another send`, async ({ page }, testInfo) => {
    await page.addInitScript(value => {
      sessionStorage.setItem('qa:scenario', value);
      localStorage.setItem('theme', value === 'native-failed' ? 'dark' : 'light');
    }, scenario);
    await page.setViewportSize(scenario === 'native-failed' ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await page.goto('/org/demo/disbursements?focus=p1');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('alert')).toContainText('No money was sent to the recipients');
    await expect(dialog.getByRole('alert')).toContainText('Create a new payment');
    await expect(dialog.getByRole('button', { name: /Retry original payment|Check settlement|Resume payment|Send payment|Cancel payment/ })).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: 'Tracking your payment' })).toHaveCount(0);
    await expect(dialog.getByText('Payment failed', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'New payment', exact: true })).toBeVisible();
    await page.reload();
    await expect(dialog.getByRole('alert')).toContainText('No money was sent to the recipients');
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${scenario}.png`), fullPage: true });
    await dialog.getByRole('link', { name: 'New payment', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Continue to timing', exact: true })).toBeVisible();
  });
}
