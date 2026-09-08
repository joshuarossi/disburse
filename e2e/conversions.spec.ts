import { expect, test, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function start(page: Page, scenario: string) {
  await page.addInitScript(
    (s) => sessionStorage.setItem("qa:scenario", `circle-conversion-${s}`),
    scenario,
  );
  await page.goto("/org/demo/treasury");
  await page
    .getByRole("button", { name: "New conversion", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  if (scenario !== "balance-outage")
    await expect(dialog).toContainText("Available USDC");
  return dialog;
}
async function review(dialog: Locator) {
  await dialog
    .getByLabel("Amount to receive · USDT", { exact: true })
    .fill("100");
  await dialog
    .getByRole("button", { name: "Review conversion", exact: true })
    .click();
  await expect(dialog).toContainText("Maximum conversion cost");
}
async function fees(dialog: Locator) {
  await dialog.getByLabel(/I reviewed the company account/).check();
  const execution = dialog.getByRole("region", { name: "Execution fees" });
  await execution
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await execution.getByRole("checkbox").check();
  return execution;
}
async function approve(execution: Locator) {
  await execution
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await execution
    .getByRole("button", { name: "Approve execution", exact: true })
    .click();
}
for (const theme of ["light", "dark"])
  test(`${theme}: a rejected conversion preserves its exact receipt and maximum cost`, async ({
    page,
  }, info) => {
    await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
    if (theme === "dark")
      await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await start(page, "declined");
    await review(dialog);
    expect(await dialog.innerText()).toContain("100 USDT");
    expect(await dialog.innerText()).toContain("100.5 USDC");
    const execution = await fees(dialog);
    await expect(execution).toContainText("101 USDC");
    await execution
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await expect(execution.getByRole("status")).toContainText(
      "Wallet confirmation cancelled",
    );
    await expect(dialog).not.toContainText("Request Arguments");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`conversion-${theme}.png`),
      fullPage: false,
    });
  });
test("a completed conversion shows the actual debit, exact receipt and execution fee", async ({
  page,
}) => {
  const dialog = await start(page, "success");
  await review(dialog);
  const execution = await fees(dialog);
  await approve(execution);
  await execution
    .getByRole("button", { name: "Convert currencies", exact: true })
    .click();
  await execution
    .getByRole("button", { name: "Check execution status", exact: true })
    .click();
  await expect(dialog).toContainText("Completed");
  await expect(dialog).toContainText("Actual amount paid");
  await expect(dialog).toContainText("100 USDT");
  await expect(dialog).toContainText("Actual fee charged");
  await expect(
    dialog.getByRole("button", { name: "Approve execution" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Review account balances" }).click();
  await expect(dialog.getByLabel("Amount to receive · USDT")).toHaveValue("");
});
test("reversing currencies quotes the desired receipt without changing recipients", async ({
  page,
}) => {
  const dialog = await start(page, "success");
  await dialog
    .getByRole("combobox", { name: "Pay with", exact: true })
    .selectOption({ label: "USDT" });
  await dialog
    .getByLabel("Amount to receive · USDC", { exact: true })
    .fill("75");
  await dialog
    .getByRole("button", { name: "Review conversion", exact: true })
    .click();
  await expect(dialog).toContainText("75 USDC");
  await expect(dialog).toContainText("75.375 USDT");
  const execution = await fees(dialog);
  await expect(execution).not.toContainText("75.875");
  await expect(execution.getByText("Maximum total account debit",{exact:true})).toHaveCount(0);
});
test("insufficient liquidity retains the entered amount and creates no approval", async ({
  page,
}) => {
  const dialog = await start(page, "no-liquidity");
  await dialog.getByLabel("Amount to receive · USDT").fill("100");
  await dialog.getByRole("button", { name: "Review conversion" }).click();
  await expect(dialog.getByRole("alert")).toContainText("enough liquidity");
  await expect(dialog.getByLabel("Amount to receive · USDT")).toHaveValue(
    "100",
  );
  await expect(
    dialog.getByRole("button", { name: "Review execution fee" }),
  ).toHaveCount(0);
});
test("unavailable balances show a bounded error and refresh", async ({
  page,
}) => {
  const dialog = await start(page, "balance-outage");
  await expect(dialog.getByRole("alert")).toContainText("could not be loaded");
  await expect(dialog).not.toContainText("private.example");
  await expect(
    dialog.getByRole("button", { name: "Refresh balances" }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Review conversion" }),
  ).toHaveCount(0);
});
test("a lost quote response can recover the one saved request", async ({
  page,
}) => {
  const dialog = await start(page, "quote-lost");
  await dialog.getByLabel("Amount to receive · USDT").fill("100");
  await dialog.getByRole("button", { name: "Review conversion" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "response was interrupted",
  );
  await page.reload();
  await page.locator('[data-service-id="service1"]').click();
  await expect(page.getByRole("dialog")).toContainText("100 USDT");
});
test("a lost submission resumes the original operation without another conversion", async ({
  page,
}) => {
  const dialog = await start(page, "unknown");
  await review(dialog);
  const execution = await fees(dialog);
  await approve(execution);
  await execution
    .getByRole("button", { name: "Convert currencies", exact: true })
    .click();
  await page.reload();
  await page.locator('[data-service-id="service1"]').click();
  await expect(page.getByRole("dialog")).toContainText("Processing");
  await expect(
    page.getByRole("button", { name: "Convert currencies", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Check execution status" }).click();
  await expect(page.getByRole("dialog")).toContainText("Processing");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
  await page.evaluate(() =>
    sessionStorage.setItem("qa:scenario", "circle-conversion-success"),
  );
  await page.getByRole("button", { name: "Check execution status" }).click();
  await expect(page.getByRole("dialog")).toContainText("Completed");
});
test("an unsigned conversion stops without a fee", async ({ page }) => {
  const dialog = await start(page, "success");
  await review(dialog);
  await dialog.getByRole("button", { name: "Stop this request" }).click();
  await expect(dialog).toContainText("Cancelled");
  await expect(
    dialog.getByRole("button", { name: "Review execution fee" }),
  ).toHaveCount(0);
});
for (const state of ["failed", "expired"])
  test(`${state}: terminal execution keeps the amount and permits a fresh review`, async ({
    page,
  }) => {
    const dialog = await start(page, state);
    await review(dialog);
    const execution = await fees(dialog);
    await approve(execution);
    await execution
      .getByRole("button", { name: "Convert currencies", exact: true })
      .click();
    await execution
      .getByRole("button", { name: "Check execution status" })
      .click();
    await expect(dialog).toContainText(
      state === "failed" ? "did not complete" : "approval window ended",
    );
    await expect(dialog).toContainText("100 USDT");
    await expect(
      dialog.getByRole("button", { name: "Review account balances" }),
    ).toBeVisible();
  });
