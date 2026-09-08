import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { amountToBaseUnits } from "../../shared/validation";

export async function receivableRefunds(
  ctx: Pick<QueryCtx, "db">,
  invoice: Doc<"receivables">,
) {
  const payments = await ctx.db
    .query("disbursements")
    .withIndex("by_refund_invoice", (q) => q.eq("refundInvoiceId", invoice._id))
    .take(101);
  if (payments.length > 100)
    throw new Error("This invoice exceeds the 100-refund review limit.");
  let refunded = 0n,
    reserved = 0n;
  for (const payment of payments) {
    if (
      payment.orgId !== invoice.orgId ||
      payment.chainId !== invoice.chainId ||
      payment.tokenAddress?.toLowerCase() !== invoice.tokenAddress.toLowerCase()
    )
      throw new Error("The invoice refund records need review.");
    const amount = amountToBaseUnits(
      payment.totalAmount ?? payment.amount ?? "0",
      invoice.token,
    );
    if (payment.status === "executed") refunded += amount;
    // Failed attempts retain their reservation until resolved/cancelled. A
    // provider failure alone does not prove an authorization is unusable.
    if (payment.status !== "cancelled") reserved += amount;
  }
  const total =
    invoice.state === "void"
      ? 0n
      : amountToBaseUnits(invoice.amount, invoice.token) -
        BigInt(invoice.credited ?? "0");
  const excess = BigInt(invoice.received) - total;
  return {
    payments,
    refunded: String(refunded),
    available: excess > reserved ? String(excess - reserved) : "0",
    reserved: String(reserved - refunded),
  };
}

export async function withReceivableRefunds(
  ctx: Pick<QueryCtx, "db">,
  invoice: Doc<"receivables">,
) {
  const refundable =
    invoice.state === "void" ||
    BigInt(invoice.received) + BigInt(invoice.credited ?? "0") >
      amountToBaseUnits(invoice.amount, invoice.token);
  return {
    ...invoice,
    refunded: refundable
      ? (await receivableRefunds(ctx, invoice)).refunded
      : "0",
  };
}
