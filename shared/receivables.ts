import { amountToBaseUnits, formatBaseUnits } from "./validation";

export function invoiceLineAmount(
  item: { quantity: number; unitPrice: string },
  token: string,
) {
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1)
    throw new Error("Use a positive whole-number quantity.");
  return formatBaseUnits(
    amountToBaseUnits(item.unitPrice, token) * BigInt(item.quantity),
    token,
  );
}

export function invoiceTotal(
  items: { quantity: number; unitPrice: string }[],
  token: string,
) {
  return formatBaseUnits(
    items.reduce(
      (total, item) =>
        total + amountToBaseUnits(invoiceLineAmount(item, token), token),
      0n,
    ),
    token,
  );
}
export function receivableStatus(
  invoice: {
    state: string;
    received: string;
    amount: string;
    token: string;
    dueDate: number;
  },
  now = Date.now(),
) {
  const received = BigInt(invoice.received);
  const expected = amountToBaseUnits(invoice.amount, invoice.token);
  if (invoice.state === "draft") return "Draft";
  if (invoice.state === "void")
    return received > 0n ? "Voided · payment received" : "Voided";
  if (received > expected) return "Overpaid";
  if (received === expected) return "Paid";
  if (received > 0n)
    return now > invoice.dueDate ? "Partial · overdue" : "Partially paid";
  return now > invoice.dueDate ? "Overdue" : "Unpaid";
}
export function receivableAmounts(invoice: {
  received: string;
  forwarded: string;
  amount: string;
  token: string;
}) {
  const received = BigInt(invoice.received),
    expected = amountToBaseUnits(invoice.amount, invoice.token),
    forwarded = BigInt(invoice.forwarded);
  return {
    received: formatBaseUnits(received, invoice.token),
    remaining: formatBaseUnits(
      expected > received ? expected - received : 0n,
      invoice.token,
    ),
    awaitingForwarding: formatBaseUnits(
      received > forwarded ? received - forwarded : 0n,
      invoice.token,
    ),
    overpayment: formatBaseUnits(
      received > expected ? received - expected : 0n,
      invoice.token,
    ),
  };
}
