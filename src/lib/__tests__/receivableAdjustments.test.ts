import { expect, it } from "vitest";
import {
  buildSettlementJournal,
  type BookAccount,
} from "../../../shared/accounting";
import {
  invoiceReminder,
  receivableAmounts,
  receivableStatus,
} from "../../../shared/receivables";
const account = (kind: BookAccount["kind"]): BookAccount => ({
  id: kind,
  externalId: kind,
  name: kind,
  kind,
  version: 1,
});
const input = {
  treatment: "credit_note" as const,
  nonCash: "credit_note" as const,
  direction: "noncash" as const,
  currency: "USD" as const,
  companyTransfer: false,
  assetBookValue: "20.00",
  obligationBookValue: "10.00",
  assetAccount: account("income"),
  counterAccount: account("receivable"),
  advanceAccount: account("liability"),
  externalName: "Customer",
};
it("balances a credit between receivable reduction and refundable liability without a cash entry", () => {
  const lines = buildSettlementJournal(input);
  expect(lines.map((l) => [l.account.kind, l.debit, l.credit])).toEqual([
    ["income", "20.00", ""],
    ["receivable", "", "10.00"],
    ["liability", "", "10.00"],
  ]);
  expect(
    buildSettlementJournal({ ...input, obligationBookValue: "0" }).map(
      (l) => l.account.kind,
    ),
  ).toEqual(["income", "liability"]);
  expect(
    buildSettlementJournal({
      ...input,
      obligationBookValue: "20",
      advanceAccount: undefined,
    }).map((l) => l.account.kind),
  ).toEqual(["income", "receivable"]);
  for (const override of [
    { obligationBookValue: "21" },
    { advanceAccount: undefined },
    { nonCash: undefined },
    { direction: "outflow" as const },
    { assetAccount: account("asset") },
    { externalName: "" },
  ])
    expect(() => buildSettlementJournal({ ...input, ...override })).toThrow();
});
it("settles a reviewed customer refund against its liability and separates the valuation difference", () => {
  const refund = {
    treatment: "customer_refund" as const,
    customerRefund: true,
    direction: "outflow" as const,
    currency: "USD" as const,
    companyTransfer: false,
    assetAccount: account("asset"),
    counterAccount: account("liability"),
    assetBookValue: "20.00",
    obligationBookValue: "19.50",
    differenceAccount: account("expense"),
    externalName: "Customer",
  };
  expect(
    buildSettlementJournal(refund).map((l) => [
      l.account.kind,
      l.debit,
      l.credit,
    ]),
  ).toEqual([
    ["asset", "", "20.00"],
    ["liability", "19.50", ""],
    ["expense", "0.50", ""],
  ]);
  expect(() =>
    buildSettlementJournal({ ...refund, customerRefund: undefined }),
  ).toThrow();
  expect(() =>
    buildSettlementJournal({ ...refund, treatment: "expense" }),
  ).toThrow();
});
it("reduces the requested amount with credits, tracks cash refunds and prepares no reminder once settled", () => {
  const invoice = {
    number: "INV-10",
    customerName: "Customer",
    dueDate: Date.now() + 86400000,
    state: "issued",
    amount: "100",
    token: "USDC",
    received: "40000000",
    forwarded: "30000000",
    credited: "20000000",
    publicToken: "a".repeat(64),
  };
  expect(receivableAmounts(invoice)).toMatchObject({
    received: "40",
    credited: "20",
    adjustedTotal: "80",
    remaining: "40",
    awaitingForwarding: "10",
  });
  const reminder = invoiceReminder(invoice, "https://app.example.invalid");
  expect(reminder.body).toContain("40 USDC");
  expect(reminder.body).toContain(`/pay/${invoice.publicToken}`);
  const refunded = {
    ...invoice,
    received: "100000000",
    forwarded: "100000000",
    credited: "100000000",
    refunded: "100000000",
  };
  expect(receivableStatus(refunded)).toBe("Refunded");
  expect(receivableAmounts(refunded).overpayment).toBe("0");
  expect(() =>
    invoiceReminder(refunded, "https://app.example.invalid"),
  ).toThrow();
  expect(() =>
    invoiceReminder(
      { ...invoice, state: "void" },
      "https://app.example.invalid",
    ),
  ).toThrow();
});
