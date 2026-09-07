import { expect, it } from "vitest";
import { extractInvoiceSuggestions } from "../../../shared/invoiceExtraction";
import {
  invoiceFileName,
  invoiceFileType,
} from "../../../shared/invoiceSource";

it("extracts explicitly labeled fields and ignores unsolicited payment addresses", () => {
  expect(
    extractInvoiceSuggestions(
      "Invoice number: INV-1042\nDue date: 2026-09-30\nSubtotal: USDC 1000.00\nAmount due: USDC 1,250.50\nSend to 0x1111111111111111111111111111111111111111",
    ),
  ).toEqual({
    invoiceNumber: "INV-1042",
    dueDate: "2026-09-30",
    amount: "1250.5",
    documentCurrency: "USDC",
    token: "USDC",
    warnings: [],
  });
});
it("does not choose among conflicting or ambiguous source values", () => {
  const result = extractInvoiceSuggestions(
    "Invoice # 1042\nInvoice # 1043\nDue date: 09/10/2026\nAmount due: USDC 1,234",
  );
  expect(result.invoiceNumber).toBeUndefined();
  expect(result.dueDate).toBeUndefined();
  expect(result.amount).toBeUndefined();
  expect(result.warnings.join(" ")).toMatch(/ambiguous/);
});
it("recognizes explicit dates and decimal formats without substituting fiat for the payment asset", () => {
  expect(
    extractInvoiceSuggestions(
      "Invoice no. INV-20\nDue date: 30 September 2026\nTotal due: EUR 1.234,56",
    ),
  ).toMatchObject({
    invoiceNumber: "INV-20",
    dueDate: "2026-09-30",
    amount: "1234.56",
    documentCurrency: "EUR",
  });
  expect(
    extractInvoiceSuggestions("Total due: EUR 1.234,56").token,
  ).toBeUndefined();
  expect(
    extractInvoiceSuggestions(
      "Due date: September 30, 2026\nAmount due: USD 20.50",
    ).warnings.join(" "),
  ).toContain("Confirm the agreed payment currency");
  expect(
    extractInvoiceSuggestions("Due date: 2026-02-30").dueDate,
  ).toBeUndefined();
  expect(
    extractInvoiceSuggestions("Amount due: -100.00 USDC").amount,
  ).toBeUndefined();
});
it("does not infer totals from invoice lines, zero amounts or injected executable content", () => {
  const result = extractInvoiceSuggestions(
    "<script>Invoice number: injected</script>\nLine item 99999\nAmount due: 0 USDC",
  );
  expect(result.amount).toBeUndefined();
  expect(result.invoiceNumber).toBeUndefined();
  const encode = (s: string) => new TextEncoder().encode(s);
  expect(() =>
    invoiceFileType(encode("<svg>code</svg>"), "image/svg+xml"),
  ).toThrow(/Use a PDF/);
  expect(() =>
    invoiceFileType(encode("<html>fake</html>"), "application/pdf"),
  ).toThrow(/matching/);
  expect(invoiceFileType(encode("%PDF-1.7"), "application/pdf")).toBe(
    "application/pdf",
  );
  expect(invoiceFileName("../invoice\r\nname.pdf")).toBe(
    ".._invoice__name.pdf",
  );
});
