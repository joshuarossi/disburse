/* eslint-disable @typescript-eslint/no-explicit-any -- isolated browser scenarios */
import { customerInvoices, recipients } from "./fixtures";
import { amountToBaseUnits, formatBaseUnits } from "../../../shared/validation";
import { receivableAmounts } from "../../../shared/receivables";
export const readARFixture = (): any =>
  JSON.parse(
    sessionStorage.getItem("qa:receivables") ??
      '{"invoices":{},"credits":[],"files":[],"refunds":[]}',
  );
const save = (data: any) =>
  sessionStorage.setItem("qa:receivables", JSON.stringify(data));
export function arInvoice(invoice: any) {
  const scenario = sessionStorage.getItem("qa:scenario");
  if (!scenario?.startsWith("ar-workflow-")) return invoice;
  return {
    ...invoice,
    ...(scenario.includes("overpaid")
      ? { received: "1700000000", forwarded: "1700000000" }
      : {}),
    ...readARFixture().invoices[invoice._id],
  };
}
export function arQuery(name: string, args: any): any {
  const data = readARFixture(),
    invoice = arInvoice(
      customerInvoices.find((i) => i._id === args.invoiceId) ??
        customerInvoices[0],
    );
  const scenario = sessionStorage.getItem("qa:scenario") ?? "";
  if (name === "invoiceFiles:forReceivable")
    return data.files.filter((f: any) => f.invoiceId === args.invoiceId);
  if (name === "receivableWorkflows:details")
    return {
      credits: data.credits.filter((c: any) => c.invoiceId === args.invoiceId),
      refunds: data.refunds,
      availableRefund: receivableAmounts(invoice).overpayment,
      refunded: "0",
      reserved: "0",
      canCredit: !scenario.includes("viewer"),
      canRefund: !scenario.includes("viewer"),
    };
  if (
    ["disbursements:getWithRecipients", "disbursements:get"].includes(name) &&
    args.disbursementId === "ar-refund"
  )
    return data.refunds[0]?.payment;
}
export async function arMutation(name: string, args: any) {
  const scenario = sessionStorage.getItem("qa:scenario") ?? "";
  if (!scenario.startsWith("ar-workflow-"))
    throw new Error("Visual QA mode is read-only.");
  const calls = JSON.parse(sessionStorage.getItem("qa:ar-calls") ?? "[]");
  calls.push({ name, args });
  sessionStorage.setItem("qa:ar-calls", JSON.stringify(calls));
  if (scenario === "ar-workflow-save-failure")
    throw new Error(
      "This request could not be saved. Keep your details and retry.",
    );
  const data = readARFixture(),
    invoice = arInvoice(
      customerInvoices.find((i) => i._id === args.invoiceId) ??
        customerInvoices[0],
    );
  if (name === "invoiceFiles:attachToReceivable") {
    if (!data.files.some((f: any) => f.id === args.fileId))
      data.files.push({
        id: args.fileId,
        invoiceId: args.invoiceId,
        name: "support.pdf",
        size: 42,
        sha256: "a".repeat(64),
        sharedWithCustomer: false,
      });
  } else if (name === "invoiceFiles:shareReceivableFile")
    data.files.find((f: any) => f.id === args.fileId).sharedWithCustomer =
      args.shared;
  else if (name === "receivableWorkflows:issueCredit") {
    const old = data.credits.find((c: any) => c.requestId === args.requestId);
    if (old) return old._id;
    const amount = amountToBaseUnits(args.amount, invoice.token);
    if (
      amount + BigInt(invoice.credited ?? "0") >
      amountToBaseUnits(invoice.amount, invoice.token)
    )
      throw new Error(
        "The credit cannot exceed the invoice amount that has not already been credited.",
      );
    data.credits.push({
      _id: "ar-credit",
      ...args,
      amountRaw: String(amount),
      issuedAt: Date.now(),
    });
    data.invoices[invoice._id] = {
      ...data.invoices[invoice._id],
      credited: String(BigInt(invoice.credited ?? "0") + amount),
    };
    save(data);
    return "ar-credit";
  } else if (name === "receivableWorkflows:prepareRefund") {
    const recipient = recipients.find((r) => r._id === args.beneficiaryId)!;
    const amount = formatBaseUnits(
      amountToBaseUnits(args.amount, invoice.token),
      invoice.token,
    );
    const payment = {
      _id: "ar-refund",
      orgId: "demo",
      safeId: args.safeId,
      chainId: invoice.chainId,
      name: `Refund · ${invoice.number}`,
      memo: `Refund · ${invoice.number}`,
      type: "batch",
      purpose: "other",
      status: "draft",
      token: invoice.token,
      tokenAddress: invoice.tokenAddress,
      totalAmount: amount,
      refundInvoiceId: invoice._id,
      createdBy: "user1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      recipients: [
        {
          _id: "refund-recipient",
          beneficiaryId: recipient._id,
          recipientName: recipient.name,
          recipientAddress: recipient.walletAddress,
          payoutVersion: recipient.payoutVersion,
          amount,
          beneficiary: recipient,
        },
      ],
    };
    data.refunds.push({
      id: payment._id,
      name: payment.name,
      amount,
      status: "draft",
      payment,
    });
    save(data);
    return payment._id;
  } else if (name === "receivableWorkflows:setFollowUp")
    data.invoices[invoice._id] = {
      ...data.invoices[invoice._id],
      followUpAt: args.at,
    };
  else if (name === "receivableWorkflows:reminderPrepared")
    data.invoices[invoice._id] = {
      ...data.invoices[invoice._id],
      followUpAt: undefined,
      lastReminderPreparedAt: Date.now(),
    };
  else if (name === "accounting:review") {
    sessionStorage.setItem("qa:ar-book-input", JSON.stringify(args));
    return "ar-journal";
  } else throw new Error("Unsupported invoice fixture operation.");
  save(data);
  return null;
}
