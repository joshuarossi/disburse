import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function start(page: Page, scenario: string) {
  await page.addInitScript(
    (value) => sessionStorage.setItem("qa:scenario", value),
    `circle-delegated-${scenario}`,
  );
  await page.goto("/org/demo/disbursements?focus=p1");
  const payment = page.getByRole("dialog", { name: "Payment details" });
  await payment
    .getByText("Pay with a spending allowance", { exact: true })
    .click();
  return payment;
}
async function reserve(page: Page, scenario: string) {
  const payment = await start(page, scenario);
  await payment
    .getByRole("button", { name: "Check my allowance", exact: true })
    .click();
  await payment
    .getByRole("button", { name: "Review fee and approval", exact: true })
    .click();
  return payment.getByRole("region", { name: "Execution fees" });
}
async function approve(fees: ReturnType<Page["locator"]>) {
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await fees.getByRole("checkbox").check();
  await fees
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Approve execution", exact: true })
    .click();
}
for (const theme of ["light", "dark"])
  test(`${theme}: cancelling the wallet prompt keeps the assigned account and readable batch`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
    if (theme === "dark")
      await page.setViewportSize({ width: 390, height: 844 });
    const fees = await reserve(page, "declined");
    expect(
      await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
    ).toBeNull();
    await fees
      .getByRole("button", { name: "Review execution fee", exact: true })
      .click();
    await fees.getByRole("checkbox").check();
    await fees
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await expect(fees.getByRole("status")).toContainText(
      "Wallet confirmation cancelled",
    );
    await expect(fees.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toContainText(
      "Alex’s payment account",
    );
    await expect(page.locator("body")).not.toContainText("Request Arguments");
    expect(await fees.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
    await fees.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`delegated-${theme}.png`),
    });
  });
test("no assigned account explains the setup before any signing", async ({
  page,
}) => {
  const payment = await start(page, "no-account");
  await expect(
    payment.getByRole("button", { name: "Check my allowance", exact: true }),
  ).toBeDisabled();
  await expect(payment).toContainText(
    "An administrator can assign you a payment account",
  );
});
test("an exceeded allowance prevents fee preparation", async ({ page }) => {
  const payment = await start(page, "over-limit");
  await payment
    .getByRole("button", { name: "Check my allowance", exact: true })
    .click();
  await expect(payment.getByRole("alert")).toContainText(
    "exceeds your remaining allowance",
  );
  await expect(
    payment.getByRole("button", {
      name: "Review fee and approval",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBeNull();
});
test("an unsigned allowance payment can be discarded without a fee", async ({
  page,
}) => {
  await reserve(page, "success");
  await page
    .getByRole("button", { name: "Cancel allowance payment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Cancelled");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBeNull();
});
test("insufficient fee funds preserve the original allowance instructions", async ({
  page,
}) => {
  const fees = await reserve(page, "insufficient");
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await expect(fees.getByRole("alert")).toContainText("enough USDC");
  await expect(
    page.getByRole("button", { name: "Cancel allowance payment", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBeNull();
});
test("a lost delegated submission survives reload without a second payment", async ({
  page,
}) => {
  const fees = await reserve(page, "unknown");
  await approve(fees);
  await fees.getByRole("button", { name: "Send payment", exact: true }).click();
  await expect(fees.getByRole("alert")).toContainText(
    "original execution request is saved",
  );
  await page.reload();
  await expect(
    fees.getByRole("button", { name: "Send payment", exact: true }),
  ).toHaveCount(0);
  await fees.getByRole("button", { name: "Check execution status" }).click();
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});
test("delegated settlement shows the actual fee and paid status", async ({
  page,
}) => {
  const fees = await reserve(page, "success");
  await approve(fees);
  await fees.getByRole("button", { name: "Send payment", exact: true }).click();
  await fees.getByRole("button", { name: "Check execution status" }).click();
  await expect(fees).toContainText("0.0075 USDC");
  await expect(page.getByRole("dialog")).toContainText("Paid");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBe("2");
});
test("assigned account setup requires a control acknowledgement and preserves its reviewed balance", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "circle-account-success"),
  );
  await page.goto("/org/demo/settings?tab=safe");
  await page
    .getByRole("button", { name: "Create company account", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Account name", { exact: true })
    .fill("Jordan’s payment account");
  await dialog
    .getByLabel("Account control", { exact: true })
    .selectOption("user2");
  const review = dialog.getByRole("button", {
    name: "Review account setup",
    exact: true,
  });
  await expect(review).toBeDisabled();
  await dialog
    .getByLabel("Initial execution balance (USDC)", { exact: true })
    .fill("5");
  await dialog.getByRole("checkbox").check();
  await review.click();
  await expect(dialog).toContainText("5 USDC, plus the setup fee");
  await expect(dialog).toContainText("Jordan Lee");
  await expect(dialog).toContainText("ownership changes");
  const fees = dialog.getByRole("region", { name: "Execution fees" });
  await approve(fees);
  await fees
    .getByRole("button", { name: "Create company account", exact: true })
    .click();
  await fees.getByRole("button", { name: "Check execution status" }).click();
  await expect(dialog).toContainText("5 USDC was assigned");
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
});

test("a signed payment uses a separately reviewed cancellation before releasing its allowance", async ({
  page,
}) => {
  const fees = await reserve(page, "success");
  await approve(fees);
  await page
    .getByRole("button", { name: "Cancel allowance payment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "invalidate its signed authorization",
  );
  await approve(fees);
  await fees
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await fees.getByRole("button", { name: "Check execution status" }).click();
  await expect(page.getByRole("dialog")).toContainText("Cancelled");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});
