import { invoiceLineAmount } from "../../../shared/receivables";
import { formatMoney } from "@/lib/formatMoney";

export function InvoiceItems({
  items,
  token,
}: {
  items: { description: string; quantity: number; unitPrice: string }[];
  token: string;
}) {
  return (
    <div
      className="overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label="Invoice items"
    >
      <ul
        className="sm:hidden print:hidden space-y-4"
        aria-label="Invoice line items"
      >
        {items.map((item, index) => (
          <li
            key={index}
            className="border-b border-slate-400/20 pb-4 last:border-0 last:pb-0"
          >
            <p className="font-medium break-words">{item.description}</p>
            <p className="mt-1 text-sm text-slate-400">
              {item.quantity} × {formatMoney(item.unitPrice, token, true)}
            </p>
            <p className="mt-2 font-semibold break-words">
              {formatMoney(invoiceLineAmount(item, token), token, true)}
            </p>
          </li>
        ))}
      </ul>
      <table className="workspace-table invoice-items hidden sm:table print:table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit price</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index}>
              <td className="whitespace-normal break-words">
                {item.description}
              </td>
              <td>{item.quantity}</td>
              <td>{formatMoney(item.unitPrice, token, true)}</td>
              <td>
                {formatMoney(invoiceLineAmount(item, token), token, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-right text-xs text-slate-400">
        Amounts in {token}
      </p>
    </div>
  );
}
