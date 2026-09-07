import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

for (const mode of ["desktop-light", "mobile-dark"]) {
  test(`${mode}: payout review shows complete old and new instructions and requires independent evidence`, async ({
    page,
  }) => {
    if (mode.startsWith("mobile"))
      await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      ({ mode }) => {
        sessionStorage.setItem("qa:scenario", "payout-review");
        localStorage.setItem(
          "theme",
          mode.endsWith("light") ? "light" : "dark",
        );
      },
      { mode },
    );
    await page.goto("/org/demo/beneficiaries");
    await page.getByRole("tab", { name: "Needs review", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: "Maya Chen" });
    await expect(row).toContainText("Payout review pending");
    await row
      .getByRole("button", { name: "Review payout", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Review payout details" });
    await expect(dialog).toContainText(
      "0x5555555555555555555555555555555555555555",
    );
    await expect(dialog).toContainText(
      "0x5555ffffffffffffffffffffffffffffffff5555",
    );
    await expect(dialog).toContainText("same beginning and ending");
    const approve = dialog.getByRole("button", {
      name: "Approve payout details",
      exact: true,
    });
    await expect(approve).toBeDisabled();
    await dialog
      .getByLabel("Review note")
      .fill("Confirmed with Maya on her existing company phone contact.");
    await expect(approve).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await expect(approve).toBeEnabled();
    await page.screenshot({
      path: `.local/qa/payout-review-${mode}.png`,
      fullPage: true,
    });
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
    await approve.click();
    await expect(
      dialog.getByRole("alert").filter({ hasText: "read-only" }),
    ).toBeVisible();
  });
}

test("requesters cannot approve their own changes when another approver is available", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "payout-review-self"),
  );
  await page.goto("/org/demo/beneficiaries");
  await page
    .getByRole("row")
    .filter({ hasText: "Maya Chen" })
    .getByRole("button", { name: "Review payout", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Another approver must review this request",
  );
  await expect(
    dialog.getByRole("button", { name: "Approve payout details" }),
  ).toHaveCount(0);
});

test("payments with invalidated payout instructions keep cancellation available and cannot be approved or sent", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "payout-review-payment"),
  );
  await page.goto("/org/demo/disbursements?focus=p2");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Its prior approvals cannot be used");
  await expect(
    dialog.getByRole("button", { name: "Approve", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Send payment", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Cancel payment", exact: true }),
  ).toBeEnabled();
});

test("recipients awaiting review cannot enter a new payment", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "payout-review"),
  );
  await page.goto("/org/demo/disbursements?new=1");
  await expect(
    page.getByRole("checkbox", { name: "Select Maya Chen", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Select James Okafor", exact: true }),
  ).toBeVisible();
});
