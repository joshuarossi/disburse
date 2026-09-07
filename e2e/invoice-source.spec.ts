import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

function pdfSource() {
  const lines = [
    "Studio North",
    "Invoice number: INV-1042",
    "Due date: 2026-09-30",
    "Design services",
    "Subtotal: USDC 1000.00",
    "Amount due: USDC 1,250.50",
    "Payment address: 0x9999999999999999999999999999999999999999",
  ];
  const stream =
    "BT /F1 16 Tf 50 750 Td " +
    lines.map((s, i) => (i ? "0 -34 Td " : "") + "(" + s + ") Tj").join("\n") +
    " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let data = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n ")
    .join(
      "\n",
    )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return {
    name: "studio-north-invoice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(data),
  };
}
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
  test(`reads a real PDF and requires review before using it in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await page.goto("/org/demo/invoices");
    await page.getByRole("button", { name: "Add bill", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add a bill" });
    await dialog
      .getByLabel("Choose an invoice file (optional)", { exact: true })
      .setInputFiles(pdfSource());
    await expect(
      dialog.getByRole("heading", { name: "Suggested bill details" }),
    ).toBeVisible();
    await expect(
      dialog.getByLabel("Invoice number", { exact: true }),
    ).toHaveValue("");
    await expect(
      dialog.getByRole("combobox", { name: "Vendor or contractor", exact: true }),
    ).toHaveValue("");
    await dialog
      .getByText("View source · page 1 of 1", { exact: true })
      .click();
    await expect(
      dialog.getByRole("img", { name: "First page of the source invoice" }),
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .include("dialog")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await dialog
      .getByRole("img", { name: "First page of the source invoice" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.local/qa/invoice-source-${theme}.png`,
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Use suggested fields", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Invoice number", { exact: true }),
    ).toHaveValue("INV-1042");
    await expect(dialog.getByLabel("Amount due", { exact: true })).toHaveValue(
      "1250.5",
    );
    await expect(dialog.getByLabel("Due date", { exact: true })).toHaveValue(
      "2026-09-30",
    );
    await expect(
      dialog.getByRole("combobox", { name: "Vendor or contractor", exact: true }),
    ).toHaveValue("");
    await dialog
      .getByRole("combobox", { name: "Vendor or contractor", exact: true })
      .selectOption("r0");
    await expect(
      dialog.getByRole("button", { name: "Add bill", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("checkbox", { name: /^I checked the recipient/ })
      .check();
    await expect(
      dialog.getByRole("button", { name: "Add bill", exact: true }),
    ).toBeEnabled();
    await dialog.getByLabel("Amount due", { exact: true }).fill("1500");
    await expect(
      dialog.getByRole("checkbox", { name: /^I checked the recipient/ }),
    ).not.toBeChecked();
    await dialog
      .getByRole("checkbox", { name: /^I checked the recipient/ })
      .check();
    await dialog.getByRole("button", { name: "Add bill", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "document upload was interrupted",
    );
    await expect(dialog.getByLabel("Amount due", { exact: true })).toHaveValue(
      "1500",
    );
    await expect(
      dialog.getByRole("button", { name: "Add bill", exact: true }),
    ).toBeEnabled();
  });
}
test("ambiguous source values stay manual and removing the selection removes the review gate", async ({
  page,
}) => {
  await page.goto("/org/demo/invoices");
  await page.getByRole("button", { name: "Add bill", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Choose an invoice file (optional)")
    .setInputFiles({
      name: "ambiguous.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Invoice number: INV-88\nDue date: 09/10/2026\nAmount due: USDC 1,234",
      ),
    });
  await expect(dialog).toContainText("Amount due is ambiguous");
  await expect(dialog).toContainText("Due date is ambiguous");
  await dialog
    .getByRole("button", { name: "Use suggested fields", exact: true })
    .click();
  await expect(dialog.getByLabel("Due date", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Amount due", { exact: true })).toHaveValue(
    "",
  );
  await dialog
    .getByRole("button", { name: "Remove selection", exact: true })
    .click();
  await expect(
    dialog.getByRole("checkbox", { name: /^I checked/ }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Add bill", exact: true }),
  ).toBeEnabled();
});
test("oversized files are rejected before upload or document reading", async ({
  page,
}) => {
  await page.goto("/org/demo/invoices");
  await page.getByRole("button", { name: "Add bill", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Choose an invoice file (optional)")
    .setInputFiles({
      name: "too-large.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
  await expect(dialog.getByRole("alert")).toContainText("10 MB");
  await expect(
    dialog.getByRole("button", { name: "Use suggested fields" }),
  ).toHaveCount(0);
});
test("saved source download failure leaves the bill and its source record visible", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "bill-source-saved"),
  );
  await page.goto("/org/demo/invoices?focus=b1");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("region", { name: "Saved source documents" }),
  ).toContainText("supplier-invoice.pdf");
  await dialog
    .getByRole("button", { name: "Download source", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "document download was interrupted",
  );
  await expect(
    dialog.getByRole("button", { name: "Prepare payment", exact: true }),
  ).toBeVisible();
});
