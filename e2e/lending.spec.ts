import { expect, test, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function start(page: Page, scenario: string) {
  await page.addInitScript(
    (value) => sessionStorage.setItem("qa:scenario", value),
    `circle-lending-${scenario}`,
  );
  await page.goto("/org/demo/treasury");
  await page.getByRole("button", { name: "View lending", exact: true }).click();
  const dialog = page.getByRole("dialog");
  if (scenario !== "position-outage")
    await expect(dialog).toContainText("Variable supply APR");
  return dialog;
}
async function quote(page: Page, scenario: string, kind = "lend") {
  const dialog = await start(page, scenario);
  if (kind === "withdraw")
    await dialog
      .getByRole("button", { name: "Withdraw funds", exact: true })
      .click();
  await dialog
    .getByLabel(`Amount to ${kind} · USDC`, { exact: true })
    .fill("100");
  await dialog
    .getByRole("button", { name: "Review amount", exact: true })
    .click();
  await expect(dialog).toContainText("100 USDC");
  return dialog;
}
async function fees(dialog: Locator) {
  await dialog.getByLabel(/I reviewed the company account/).check();
  const fees = dialog.getByRole("region", { name: "Execution fees" });
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await fees.getByRole("checkbox").check();
  return fees;
}
async function approve(fees: Locator) {
  await fees
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Approve execution", exact: true })
    .click();
}
test("withdraw all clearly reviews an estimate and displays the actual received quantity", async ({
  page,
}) => {
  const dialog = await start(page, "success");
  await dialog.getByRole("button", { name: "Withdraw funds" }).click();
  await dialog.getByLabel(/Withdraw the full position/).check();
  await expect(dialog.getByLabel("Amount to withdraw · USDC")).toHaveValue(
    "5000",
  );
  await expect(dialog.getByLabel("Amount to withdraw · USDC")).toBeDisabled();
  await dialog.getByRole("button", { name: "Review amount" }).click();
  await expect(dialog).toContainText("Estimated 5000 USDC");
  await expect(dialog).toContainText("final amount depends on its balance");
  const execution = await fees(dialog);
  await approve(execution);
  await execution.getByRole("button", { name: "Withdraw to account" }).click();
  await execution
    .getByRole("button", { name: "Check execution status" })
    .click();
  await expect(dialog).toContainText("5000.000001 USDC");
  await expect(dialog).not.toContainText("Estimated 5000");
});
for (const theme of ["light", "dark"])
  test(`${theme}: declined lending approval retains the amount and fits the screen`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    if (theme === "dark")
      await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await quote(page, "declined"),
      execution = await fees(dialog);
    await expect(execution).toContainText("100.5 USDC");
    await execution
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await expect(execution.getByRole("status")).toContainText(
      "Wallet confirmation cancelled",
    );
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(dialog).not.toContainText("Request Arguments");
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath(`lending-${theme}.png`) });
  });
for (const kind of ["lend", "withdraw"])
  test(`${kind}: account owners approve the operation and completion requires a receipt`, async ({
    page,
  }) => {
    const dialog = await quote(page, "success", kind),
      execution = await fees(dialog);
    await approve(execution);
    await execution
      .getByRole("button", {
        name: kind === "lend" ? "Deposit with Aave" : "Withdraw to account",
        exact: true,
      })
      .click();
    await expect(dialog).toContainText("Processing");
    await expect(
      dialog.getByRole("button", { name: "Stop this request" }),
    ).toHaveCount(0);
    await execution
      .getByRole("button", { name: "Check execution status" })
      .click();
    await expect(
      dialog.getByRole("link", { name: "View confirmed transaction" }),
    ).toBeVisible();
    await expect(execution).toContainText("Actual fee charged");
    await expect(execution).toContainText("0.0075 USDC");
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("qa:circle-submissions"),
      ),
    ).toBe("1");
  });
for (const scenario of ["depeg", "stale-price"])
  test(`${scenario}: new deposits stop while withdrawals stay available`, async ({
    page,
  }) => {
    const dialog = await start(page, scenario);
    await dialog
      .getByLabel("Amount to lend · USDC", { exact: true })
      .fill("100");
    await expect(
      dialog.getByRole("button", { name: "Review amount" }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Withdraw funds", exact: true })
      .click();
    await dialog
      .getByLabel("Amount to withdraw · USDC", { exact: true })
      .fill("100");
    await expect(
      dialog.getByRole("button", { name: "Review amount" }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Review amount" }).click();
    await expect(dialog).toContainText("Withdrawal to your account");
  });
test("unavailable withdrawal liquidity retains the position and entered amount", async ({
  page,
}) => {
  const dialog = await start(page, "liquidity");
  await dialog.getByRole("button", { name: "Withdraw funds" }).click();
  await dialog.getByLabel("Amount to withdraw · USDC").fill("100");
  await dialog.getByRole("button", { name: "Review amount" }).click();
  await expect(dialog.getByRole("alert")).toContainText("available liquidity");
  await expect(dialog.getByLabel("Amount to withdraw · USDC")).toHaveValue(
    "100",
  );
  await expect(dialog).toContainText("5000 USDC");
});
test("a provider outage has a recovery action and no wallet controls", async ({
  page,
}) => {
  const dialog = await start(page, "position-outage");
  await expect(dialog.getByRole("alert")).toContainText("could not be loaded");
  await expect(dialog).not.toContainText("private.example");
  await expect(
    dialog.getByRole("button", { name: "Refresh position" }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Review amount" }),
  ).toHaveCount(0);
});
test("a lost submission can be reopened without another deposit", async ({
  page,
}) => {
  const dialog = await quote(page, "unknown"),
    execution = await fees(dialog);
  await approve(execution);
  await execution.getByRole("button", { name: "Deposit with Aave" }).click();
  await page.reload();
  await page.locator('[data-service-id="service1"]').click();
  await expect(dialog).toContainText("Processing");
  await expect(
    dialog.getByRole("button", { name: "Deposit with Aave" }),
  ).toHaveCount(0);
  await execution
    .getByRole("button", { name: "Check execution status" })
    .click();
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});
test("an unsigned request stops without an execution fee", async ({ page }) => {
  const dialog = await quote(page, "success");
  await dialog.getByRole("button", { name: "Stop this request" }).click();
  await expect(dialog).toContainText("Cancelled");
  await expect(
    dialog.getByRole("button", { name: "Review execution fee" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBeNull();
});
test("a signed cancellation consumes the original approval and preserves the cancellation fee", async ({
  page,
}) => {
  const dialog = await quote(page, "success"),
    execution = await fees(dialog);
  await approve(execution);
  await dialog.getByRole("button", { name: "Stop this request" }).click();
  const cancellation = dialog
    .getByRole("region", { name: "Execution fees" })
    .last();
  await cancellation
    .getByRole("button", { name: "Review execution fee" })
    .click();
  await cancellation.getByRole("checkbox").check();
  await approve(cancellation);
  await cancellation
    .getByRole("button", { name: "Confirm cancellation" })
    .click();
  await cancellation
    .getByRole("button", { name: "Check execution status" })
    .click();
  await expect(dialog).toContainText("Cancelled");
  await expect(cancellation).toContainText("Actual fee charged");
});
