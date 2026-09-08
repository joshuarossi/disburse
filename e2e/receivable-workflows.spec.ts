import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const invoicePath = `/pay/${"a".repeat(64)}`;
async function start(page: Page, scenario = "normal") {
  await page.addInitScript(
    (s) => sessionStorage.setItem("qa:scenario", `ar-workflow-${s}`),
    scenario,
  );
  await page.goto("/org/demo/receivables");
  await page
    .getByRole("button", { name: "INV-2026-1042", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Invoice INV-2026-1042" });
}
async function credit(page: Page, amount = "100") {
  const section = page.getByRole("region", { name: "Credits and refunds" });
  await section
    .getByRole("button", { name: "Issue credit note", exact: true })
    .click();
  await section
    .getByLabel("Credit note number", { exact: true })
    .fill("CN-1042");
  await section
    .getByLabel("Reason shown to the customer", { exact: true })
    .fill("Agreed reduction for the revised scope of services");
  await section
    .getByLabel("Credit amount · USDC", { exact: true })
    .fill(amount);
  await expect(
    section.getByRole("button", { name: "Issue credit", exact: true }),
  ).toBeDisabled();
  await section.getByRole("checkbox").check();
  await section
    .getByRole("button", { name: "Issue credit", exact: true })
    .click();
  return section;
}
for (const theme of ["light", "dark"])
  test(`${theme}: credit review is readable and preserves the original invoice after issuing`, async ({
    page,
  }, info) => {
    await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
    await page.setViewportSize({
      width: theme === "dark" ? 390 : 1440,
      height: 1000,
    });
    const dialog = await start(page);
    const section = await credit(page);
    await expect(
      section.getByText("CN-1042", { exact: false }).first(),
    ).toBeVisible();
    await expect(dialog).toContainText("adjusted total 1400 USDC");
    await expect(
      section.getByRole("button", { name: "Reconcile credit CN-1042" }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`credit-${theme}.png`) });
    await page.goto(invoicePath);
    await expect(
      page.getByRole("region", { name: "Credit notes" }),
    ).toContainText("CN-1042");
    await expect(page.getByText("900 USDC", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Original total", { exact: true }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`customer-credit-${theme}.png`),
      fullPage: true,
    });
  });
test("a failed credit save retains its details and never claims that funds moved", async ({
  page,
}) => {
  const dialog = await start(page, "save-failure");
  await credit(page);
  await expect(dialog.getByRole("alert")).toContainText(
    "Keep your details and retry",
  );
  await expect(
    dialog.getByLabel("Credit note number", { exact: true }),
  ).toHaveValue("CN-1042");
  await expect(
    dialog.getByLabel("Credit amount · USDC", { exact: true }),
  ).toHaveValue("100");
  await expect(dialog).not.toContainText("Transaction complete");
  await expect(
    dialog.getByRole("button", { name: "Issue credit", exact: true }),
  ).toBeEnabled();
});
test("an excessive credit can be corrected without losing the invoice or bypassing review", async ({
  page,
}) => {
  const dialog = await start(page);
  await credit(page, "2000");
  await expect(dialog.getByRole("alert")).toContainText("cannot exceed");
  await dialog.getByLabel("Credit amount · USDC", { exact: true }).fill("100");
  await expect(
    dialog.getByRole("button", { name: "Issue credit", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("region", { name: "Credits and refunds" })
    .getByRole("checkbox")
    .check();
  await dialog
    .getByRole("button", { name: "Issue credit", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Reconcile credit CN-1042" }),
  ).toBeVisible();
});
test("the customer credit journal uses a receivable and liability split with no cash movement", async ({
  page,
}, info) => {
  await start(page);
  await credit(page);
  await page.getByRole("button", { name: "Reconcile credit CN-1042" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Reconcile with your books",
  });
  await expect(dialog).toContainText("Credit issued · no funds moved");
  await expect(
    dialog.getByText("Settlement evidence", { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("How is this recorded in your books?")
    .selectOption("credit_note");
  await dialog
    .getByLabel("Sales returns or adjustment account")
    .selectOption("gain");
  await dialog
    .getByLabel("Offset account in your books")
    .selectOption("receivable");
  await dialog
    .getByLabel("Credit book value · USD", { exact: true })
    .fill("100");
  await dialog
    .getByLabel("Receivable reduction · USD", { exact: true })
    .fill("80");
  await dialog
    .getByLabel("Customer liability for refundable credit, if needed")
    .selectOption("advance");
  await dialog
    .getByLabel("Vendor or customer name in the books")
    .fill("Acme Studio");
  await dialog.getByLabel("Book / obligation reference").fill("CN-1042");
  await dialog
    .getByLabel("Book value evidence")
    .fill(
      "Reviewed customer receivable balance and the remaining customer credit",
    );
  const journal = dialog.getByRole("table", { name: "Journal preview in USD" });
  await expect(journal).toContainText("Accounts Receivable");
  await expect(journal).toContainText("80.00");
  await expect(journal).toContainText("Customer advances");
  await expect(journal).toContainText("20.00");
  await dialog.getByLabel(/I reviewed the book values/).check();
  await dialog
    .getByRole("button", { name: "Prepare journal", exact: true })
    .click();
  await expect(
    dialog.getByText("Ready to export", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("credit-journal.png") });
});
test("a refund uses a reviewed beneficiary and opens the normal one-recipient payment review", async ({
  page,
}) => {
  const dialog = await start(page, "overpaid");
  await dialog
    .getByRole("button", { name: "Prepare refund", exact: true })
    .click();
  const recipient = dialog.getByRole("combobox", {
    name: "Refund recipient",
    exact: true,
  });
  await expect(
    recipient.locator("option").filter({ hasText: "Arjun Patel" }),
  ).toHaveCount(0);
  await expect(
    recipient.locator("option").filter({ hasText: "Sofia Garcia" }),
  ).toHaveCount(0);
  await recipient.selectOption("r0");
  await dialog.getByLabel("Refund amount · USDC", { exact: true }).fill("200");
  await expect(
    dialog.getByRole("button", { name: "Save refund draft", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel(/I confirmed this reviewed recipient/).check();
  await dialog
    .getByRole("button", { name: "Save refund draft", exact: true })
    .click();
  await expect(page).toHaveURL(/disbursements\?focus=ar-refund/);
  await expect(page.getByRole("dialog")).toContainText("Maya Chen");
  await expect(
    page.getByRole("button", { name: "Edit draft", exact: true }),
  ).toHaveCount(0);
  const args = await page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem("qa:ar-calls")!).find(
        (c: { name: string }) => c.name === "receivableWorkflows:prepareRefund",
      ).args,
  );
  expect(args.beneficiaryId).toBe("r0");
  expect(args.amount).toBe("200");
  expect(args).not.toHaveProperty("recipientAddress");
});
test("a private attachment is shared explicitly, can be downloaded, and can be made private again", async ({
  page,
}) => {
  await page.route("**/invoice-files?*", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ fileId: "file-ar1" }),
        })
      : route.fulfill({
          status: 200,
          contentType: "application/pdf",
          body: "%PDF-1.7\nSource fixture\n%%EOF",
        }),
  );
  const dialog = await start(page),
    documents = dialog.getByRole("region", { name: "Invoice documents" });
  await documents
    .getByLabel("Attach a supporting document")
    .setInputFiles({
      name: "support.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nDocument\n%%EOF"),
    });
  await documents
    .getByRole("button", { name: "Save private document" })
    .click();
  await expect(documents.getByText(/Private to your team/)).toBeVisible();
  await page.goto(invoicePath);
  await expect(
    page.getByRole("region", { name: "Supporting documents" }),
  ).toHaveCount(0);
  await page.goto("/org/demo/receivables");
  await page
    .getByRole("button", { name: "INV-2026-1042", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Share support.pdf with customer" })
    .click();
  await page.goto(invoicePath);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download support.pdf" }).click();
  expect((await download).suggestedFilename()).toBe("support.pdf");
  await page.goto("/org/demo/receivables");
  await page
    .getByRole("button", { name: "INV-2026-1042", exact: true })
    .click();
  await page.getByRole("button", { name: "Make support.pdf private" }).click();
  await page.goto(invoicePath);
  await expect(
    page.getByRole("region", { name: "Supporting documents" }),
  ).toHaveCount(0);
});
test("an interrupted upload preserves the same request identity for retry", async ({
  page,
}) => {
  let attempts = 0;
  const requestIds: string[] = [];
  await page.route("**/invoice-files?*", (route) => {
    requestIds.push(route.request().headers()["x-request-id"]);
    return ++attempts === 1
      ? route.abort()
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ fileId: "file-ar1" }),
        });
  });
  const dialog = await start(page),
    documents = dialog.getByRole("region", { name: "Invoice documents" });
  await documents
    .getByLabel("Attach a supporting document")
    .setInputFiles({
      name: "support.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nDocument\n%%EOF"),
    });
  await documents
    .getByRole("button", { name: "Save private document" })
    .click();
  await expect(documents.getByRole("alert")).toContainText("interrupted");
  await documents
    .getByRole("button", { name: "Save private document" })
    .click();
  await expect(documents.getByText(/Private to your team/)).toBeVisible();
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
});
test("a copied reminder uses the current unpaid balance and records preparation without sending mail", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const dialog = await start(page),
    reminders = dialog.getByRole("region", { name: "Payment reminders" });
  await reminders
    .getByLabel("Next follow-up", { exact: true })
    .fill("2026-09-01");
  await reminders
    .getByRole("button", { name: "Save follow-up", exact: true })
    .click();
  await expect(reminders.getByText(/Follow-up due/)).toBeVisible();
  await reminders
    .getByRole("button", { name: "Copy reminder", exact: true })
    .click();
  await expect(reminders).toContainText("Delivery is not tracked");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("1000 USDC");
  expect(copied).toContain(invoicePath);
  await expect(
    reminders.getByRole("link", { name: "Open email draft" }),
  ).toHaveAttribute("href", /^mailto:accounts%40example.invalid\?/);
  await expect(reminders).not.toContainText("Reminder sent");
});
test("a viewer can inspect invoice adjustments but cannot issue credits, refunds, reminders or attachments", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "ar-viewer"),
  );
  await page.goto("/org/demo/receivables");
  await page
    .getByRole("button", { name: "INV-2026-1042", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  for (const name of [
    "Issue credit note",
    "Prepare refund",
    "Copy reminder",
    "Save private document",
  ])
    await expect(dialog.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
});
