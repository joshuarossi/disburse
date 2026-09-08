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
    credited?: string;
    refunded?: string;
  },
  now = Date.now(),
) {
  const received = BigInt(invoice.received) - BigInt(invoice.refunded ?? "0");
  const expected =
    amountToBaseUnits(invoice.amount, invoice.token) -
    BigInt(invoice.credited ?? "0");
  if (invoice.state === "draft") return "Draft";
  if (invoice.state === "void")
    return received > 0n ? "Voided · payment received" : "Voided";
  if (received > expected) return "Overpaid";
  if (received === expected)
    return expected === 0n && BigInt(invoice.credited ?? "0") > 0n
      ? BigInt(invoice.refunded ?? "0") > 0n
        ? "Refunded"
        : "Credited"
      : "Paid";
  if (received > 0n)
    return now > invoice.dueDate ? "Partial · overdue" : "Partially paid";
  return now > invoice.dueDate ? "Overdue" : "Unpaid";
}
export function receivableAmounts(invoice: {
  received: string;
  forwarded: string;
  amount: string;
  token: string;
  credited?: string;
  refunded?: string;
  state?: string;
}) {
  const received = BigInt(invoice.received),
    credited = BigInt(invoice.credited ?? "0"),
    refunded = BigInt(invoice.refunded ?? "0"),
    expected =
      invoice.state === "void"
        ? 0n
        : amountToBaseUnits(invoice.amount, invoice.token) - credited,
    retained = received - refunded,
    forwarded = BigInt(invoice.forwarded);
  return {
    received: formatBaseUnits(received, invoice.token),
    credited: formatBaseUnits(credited, invoice.token),
    refunded: formatBaseUnits(refunded, invoice.token),
    adjustedTotal: formatBaseUnits(expected, invoice.token),
    remaining: formatBaseUnits(
      expected > retained ? expected - retained : 0n,
      invoice.token,
    ),
    awaitingForwarding: formatBaseUnits(
      received > forwarded ? received - forwarded : 0n,
      invoice.token,
    ),
    overpayment: formatBaseUnits(
      retained > expected ? retained - expected : 0n,
      invoice.token,
    ),
  };
}

export function invoiceReminder(
  invoice: {
    number: string;
    customerName: string;
    token: string;
    dueDate: number;
    publicToken?: string;
    state: string;
    amount: string;
    received: string;
    forwarded: string;
    credited?: string;
    refunded?: string;
  },
  origin: string,
) {
  const amounts = receivableAmounts(invoice);
  if (
    invoice.state !== "issued" ||
    !invoice.publicToken ||
    amounts.remaining === "0"
  )
    throw new Error(
      "Only issued invoices with an unpaid balance need a payment reminder.",
    );
  const url = new URL(`/pay/${invoice.publicToken}`, origin);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("The invoice link is unavailable.");
  return {
    subject: `Payment reminder: invoice ${invoice.number}`,
    body: `Hello ${invoice.customerName},\n\nInvoice ${invoice.number} has a remaining balance of ${amounts.remaining} ${invoice.token}, due ${new Date(invoice.dueDate).toISOString().slice(0, 10)}.\n\nView the invoice and current payment instructions:\n${url.href}\n\nIf you have already paid, please allow time for confirmation or share the payment reference with us.\n\nThank you.`,
  };
}
