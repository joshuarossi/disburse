import { expect, test, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function start(page: Page, scenario: string) {
  await page.addInitScript(
    (value) => sessionStorage.setItem("qa:scenario", value),
    `circle-treasury-${scenario}`,
  );
  await page.goto("/org/demo/treasury");
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  return page.getByRole("dialog");
}
async function quote(page: Page, scenario: string) {
  const dialog = await start(page, scenario);
  await dialog
    .getByLabel("Amount to receive, USDC", { exact: true })
    .fill("100");
  await dialog
    .getByRole("button", { name: "Review transfer", exact: true })
    .click();
  return dialog;
}
async function review(dialog: Locator) {
  await dialog.getByLabel(/I have reviewed the receiving account/).check();
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
for (const theme of ["light", "dark"])
  test(`${theme}: a rejected wallet confirmation keeps the reviewed accounts and fee limits`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    if (theme === "dark")
      await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await quote(page, "declined"),
      fees = await review(dialog);
    await expect(dialog).toContainText("Operations → Payroll");
    await expect(dialog).toContainText("100.25 USDC");
    await expect(fees).toContainText("100.75 USDC");
    await fees
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await expect(fees.getByRole("status")).toContainText(
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
    await fees.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`treasury-${theme}.png`) });
  });
test("a transfer stays in transit until the receiving receipt is verified", async ({
  page,
}) => {
  const dialog = await quote(page, "success"),
    fees = await review(dialog);
  await approve(fees);
  await fees
    .getByRole("button", { name: "Start transfer", exact: true })
    .click();
  await fees.getByRole("button", { name: "Check execution status" }).click();
  await expect(dialog).toContainText("On its way");
  await expect(
    dialog.getByRole("link", { name: "Sending receipt" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Receiving receipt" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Stop transfer", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Check transfer status", exact: true })
    .click();
  await expect(
    dialog.getByRole("link", { name: "Receiving receipt" }),
  ).toBeVisible();
  await expect(dialog).toContainText("100.05 USDC");
  await expect(dialog).toContainText("0.2 USDC");
  await expect(
    fees.getByRole("heading", { name: "Execution receipt", exact: true }),
  ).toBeVisible();
  await expect(fees.getByText(/Complete the .* approvals/)).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});
test("a lost submission is recovered after reload without a second transfer", async ({
  page,
}) => {
  const dialog = await quote(page, "unknown"),
    fees = await review(dialog);
  await approve(fees);
  await fees
    .getByRole("button", { name: "Start transfer", exact: true })
    .click();
  await expect(fees.getByRole("alert")).toContainText(
    "original execution request is saved",
  );
  await page.reload();
  await page
    .getByRole("region", { name: "Transfers between accounts" })
    .getByRole("button", { name: /Operations → Payroll/ })
    .click();
  await expect(dialog).toContainText("Sending");
  await expect(
    fees.getByRole("button", { name: "Start transfer", exact: true }),
  ).toHaveCount(0);
  await fees.getByRole("button", { name: "Check execution status" }).click();
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});
test("a delivery outage retains the sent funds and original receipt", async ({
  page,
}) => {
  const dialog = await quote(page, "delivery-outage"),
    fees = await review(dialog);
  await approve(fees);
  await fees
    .getByRole("button", { name: "Start transfer", exact: true })
    .click();
  await fees.getByRole("button", { name: "Check execution status" }).click();
  await dialog
    .getByRole("button", { name: "Check transfer status", exact: true })
    .click();
  await expect(dialog).toContainText("Do not send a replacement");
  await expect(
    dialog.getByRole("link", { name: "Sending receipt" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Stop transfer", exact: true }),
  ).toHaveCount(0);
});
test("a manually supplied receipt requires verification and cannot mark a transfer received", async ({
  page,
}) => {
  const dialog = await quote(page, "delivery-outage"),
    fees = await review(dialog);
  await approve(fees);
  await fees
    .getByRole("button", { name: "Start transfer", exact: true })
    .click();
  await fees.getByRole("button", { name: "Check execution status" }).click();
  await dialog
    .getByText("Already have a receiving receipt?", { exact: true })
    .click();
  await dialog
    .getByLabel("Receiving transaction hash", { exact: true })
    .fill("not-a-receipt");
  await dialog
    .getByRole("button", { name: "Verify receiving receipt", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "full receiving transaction hash",
  );
  await dialog
    .getByLabel("Receiving transaction hash", { exact: true })
    .fill(`0x${"ab".repeat(32)}`);
  await dialog
    .getByRole("button", { name: "Verify receiving receipt", exact: true })
    .click();
  await expect(
    dialog.getByRole("status").filter({ hasText: "Receipt saved" }),
  ).toBeVisible();
  await expect(dialog).toContainText("On its way");
  await expect(
    dialog.getByRole("link", { name: "Receiving receipt", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});

test("an unsigned transfer can be stopped without a charge", async ({
  page,
}) => {
  const dialog = await quote(page, "success");
  await review(dialog);
  await dialog
    .getByRole("button", { name: "Stop transfer", exact: true })
    .click();
  await expect(dialog).toContainText("This transfer has been cancelled");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBeNull();
});
test("stopping a signed transfer requires a separately reviewed cancellation", async ({
  page,
}) => {
  const dialog = await quote(page, "success"),
    fees = await review(dialog);
  await approve(fees);
  await dialog
    .getByRole("button", { name: "Stop transfer", exact: true })
    .click();
  await expect(dialog).toContainText("Cancel its authorization on the network");
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await fees.getByRole("checkbox").check();
  await approve(fees);
  await fees
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await fees.getByRole("button", { name: "Check execution status" }).click();
  await expect(dialog).toContainText("This transfer has been cancelled");
  await expect(fees).toContainText("0.0075 USDC");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});
test("quote failure preserves the input without requesting a signature", async ({
  page,
}) => {
  const dialog = await quote(page, "quote-outage");
  await expect(dialog.getByRole("alert")).toContainText(
    "transfer service is unavailable",
  );
  await expect(dialog.getByLabel("Amount to receive, USDC")).toHaveValue("100");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBeNull();
});
test("a saved quote is visible after its response is lost", async ({
  page,
}) => {
  const dialog = await quote(page, "quote-lost");
  await expect(dialog.getByRole("alert")).toContainText(
    "quote response was interrupted",
  );
  await page.reload();
  await page
    .getByRole("region", { name: "Transfers between accounts" })
    .getByRole("button", { name: /Operations → Payroll/ })
    .click();
  await expect(dialog).toContainText("100.25 USDC");
});
test("viewers can read transfers but cannot create one", async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "circle-treasury-viewer"),
  );
  await page.goto("/org/demo/treasury");
  await expect(
    page.getByRole("region", { name: "Transfers between accounts" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New transfer", exact: true }),
  ).toHaveCount(0);
});
test("unsupported account combinations explain what is needed", async ({
  page,
}) => {
  const dialog = await start(page, "no-route");
  await expect(dialog).toContainText(
    "Connect accounts on two supported networks",
  );
  await expect(
    dialog.getByRole("button", { name: "Review transfer", exact: true }),
  ).toHaveCount(0);
});

test("insufficient execution funds leave the quote available to stop or fund", async ({
  page,
}) => {
  const dialog = await quote(page, "insufficient");
  await dialog.getByLabel(/I have reviewed the receiving account/).check();
  const fees = dialog.getByRole("region", { name: "Execution fees" });
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await expect(fees.getByRole("alert")).toContainText("enough USDC");
  await expect(
    dialog.getByRole("button", { name: "Stop transfer", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBeNull();
});
for (const scenario of ["failed", "expired"])
  test(`${scenario}: an unsuccessful execution is distinct from funds in transit`, async ({
    page,
  }) => {
    const dialog = await quote(page, scenario),
      fees = await review(dialog);
    await approve(fees);
    await fees
      .getByRole("button", { name: "Start transfer", exact: true })
      .click();
    await fees.getByRole("button", { name: "Check execution status" }).click();
    await expect(dialog).toContainText(
      scenario === "failed" ? "The transfer did not start" : "quote expired",
    );
    if (scenario === "failed") await expect(fees).toContainText("0.0075 USDC");
    await expect(
      dialog.getByRole("link", { name: "Receiving receipt" }),
    ).toHaveCount(0);
    await expect(
      fees.getByRole("button", { name: "Start transfer", exact: true }),
    ).toHaveCount(0);
  });
