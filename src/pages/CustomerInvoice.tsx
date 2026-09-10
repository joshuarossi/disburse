import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { tx, useWorkspaceLanguage, workspaceLocale } from "@/lib/workspaceI18n";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../convex/_generated/api";
import { formatDate, formatMoney } from "@/lib/formatMoney";
import { getChainName } from "@/lib/chains";
import { InvoiceItems } from "@/components/invoices/InvoiceItems";
import { downloadInvoiceFile } from "@/lib/invoiceFileClient";
import { userErrorMessage } from "@/lib/userErrors";
export default function CustomerInvoice() {
  useWorkspaceLanguage();
  const { token } = useParams();
  const invoice = useQuery(
    api.receivables.publicInvoice,
    token ? { token } : "skip",
  );
  const [copied, setCopied] = useState("");
  const [documentError, setDocumentError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [slowToken, setSlowToken] = useState<string>();
  useEffect(() => {
    if (invoice !== undefined) return;
    const timer = setTimeout(() => setSlowToken(token), 10_000);
    return () => clearTimeout(timer);
  }, [invoice, token]);
  if (invoice === undefined || !invoice)
    return (
      <main className="customer-invoice mx-auto max-w-2xl space-y-6 px-5 py-10">
        <Link to="/" className="text-sm font-semibold text-[var(--ws-accent)]">
          {tx("Disburse")}
        </Link>
        <div className="flex justify-end print:hidden">
          <LanguageSwitcher inline />
        </div>
        <section className="workspace-panel space-y-4 p-6">
          {invoice === undefined ? (
            <>
              <h1 className="text-2xl font-semibold">
                {slowToken === token
                  ? tx("Invoice taking longer to load")
                  : tx("Loading invoice")}
              </h1>
              <p role="status" className="workspace-description">
                {slowToken === token
                  ? tx(
                      "Check your connection and try loading the invoice again.",
                    )
                  : tx("Getting the latest invoice and payment status…")}
              </p>
              {slowToken === token && (
                <button
                  className="workspace-button workspace-button-primary"
                  onClick={() => window.location.reload()}
                >
                  {tx("Reload invoice")}
                </button>
              )}
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold">
                {tx("Invoice not found")}
              </h1>
              <p className="workspace-description">
                {tx("Check the payment link with the business that sent it.")}
              </p>
            </>
          )}
        </section>
      </main>
    );
  const testnet = [11155111, 84532].includes(invoice.chainId);
  return (
    <main className="customer-invoice mx-auto max-w-3xl space-y-6 px-5 py-10">
      <div className="flex justify-end print:hidden">
        <LanguageSwitcher inline />
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">{tx("Invoice from")}</p>
          <h1 className="text-3xl font-semibold">{invoice.issuer}</h1>
        </div>
        <button
          className="workspace-button print:hidden"
          onClick={() => window.print()}
        >
          {tx("Print / save PDF")}
        </button>
      </header>
      {testnet && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          {tx("Test invoice · use test funds only on")}{" "}
          {getChainName(invoice.chainId)}.
        </p>
      )}
      <section className="workspace-panel p-6 space-y-5">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{invoice.number}</h2>
            <p className="workspace-description">
              {tx("Billed to")} {invoice.customerName}
            </p>
          </div>
          <div>
            <span className="workspace-status">{tx(invoice.status)}</span>
            <p className="workspace-description">
              {tx("Due")} {formatDate(invoice.dueDate)}
            </p>
          </div>
        </div>
        <InvoiceItems items={invoice.items} token={invoice.token} />
        <div className="flex justify-between gap-4 text-xl font-semibold">
          <span>
            {invoice.credits?.length ? tx("Original total") : tx("Total")}
          </span>
          <span>
            {formatMoney(invoice.amount, invoice.token, true)} {invoice.token}
          </span>
        </div>
        {!!invoice.credits?.length && (
          <section
            aria-label={tx("Credit notes")}
            className="space-y-3 border-t border-slate-400/20 pt-4"
          >
            <h3 className="font-semibold">{tx("Credit notes")}</h3>
            {invoice.credits.map((c) => (
              <div key={c.number} className="text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{c.number}</strong>
                  <span>
                    −{formatMoney(c.amount, invoice.token, true)}{" "}
                    {invoice.token}
                  </span>
                </div>
                <p className="workspace-description">
                  {tx("Issued")} {formatDate(c.issuedAt)}
                </p>
                <p className="whitespace-pre-wrap">{c.reason}</p>
              </div>
            ))}
            <div className="flex flex-wrap justify-between gap-2 font-semibold">
              <span>{tx("Adjusted total")}</span>
              <span>
                {formatMoney(
                  invoice.amounts.adjustedTotal,
                  invoice.token,
                  true,
                )}{" "}
                {invoice.token}
              </span>
            </div>
          </section>
        )}
        {invoice.description && (
          <p className="whitespace-pre-wrap text-sm">{invoice.description}</p>
        )}
        {!!invoice.documents?.length && (
          <section
            aria-label={tx("Supporting documents")}
            className="space-y-3 border-t border-slate-400/20 pt-4"
          >
            <h3 className="font-semibold">{tx("Supporting documents")}</h3>
            <ul className="space-y-2">
              {invoice.documents.map((file) => (
                <li key={file.id}>
                  <button
                    className="workspace-action-link break-all text-left"
                    disabled={downloading}
                    onClick={async () => {
                      setDownloading(true);
                      setDocumentError("");
                      try {
                        await downloadInvoiceFile(
                          file.id,
                          file.name,
                          "",
                          token!,
                        );
                      } catch (e) {
                        setDocumentError(
                          userErrorMessage(
                            e,
                            "The document is unavailable. Contact the business or try again.",
                          ),
                        );
                      } finally {
                        setDownloading(false);
                      }
                    }}
                  >
                    {tx("Download")} {file.name}
                  </button>
                </li>
              ))}
            </ul>
            {documentError && (
              <p role="alert" className="text-sm">
                {tx(documentError)}
              </p>
            )}
          </section>
        )}
      </section>
      <section className="workspace-panel space-y-5 p-6">
        <h2 className="text-xl font-semibold">
          {invoice.voided
            ? tx("Invoice voided")
            : invoice.amounts.remaining === "0"
              ? invoice.status === "Credited"
                ? tx("Invoice credited")
                : invoice.status === "Refunded"
                  ? tx("Invoice refunded")
                  : tx("Payment received")
              : tx("Payment instructions")}
        </h2>
        <div className="flex flex-wrap justify-between gap-4">
          <p>
            {tx("Received")}{" "}
            <strong>
              {formatMoney(invoice.amounts.received, invoice.token, true)}{" "}
              {invoice.token}
            </strong>
          </p>
          {!invoice.voided && (
            <p>
              {tx("Remaining")}{" "}
              <strong>
                {formatMoney(invoice.amounts.remaining, invoice.token, true)}{" "}
                {invoice.token}
              </strong>
            </p>
          )}
        </div>
        {invoice.amounts.refunded !== undefined &&
          invoice.amounts.refunded !== "0" && (
            <p>
              {tx("Refunded")}{" "}
              <strong>
                {formatMoney(invoice.amounts.refunded, invoice.token, true)}{" "}
                {invoice.token}
              </strong>
            </p>
          )}
        {invoice.amounts.overpayment !== "0" && (
          <p>
            {tx("Customer credit:")}{" "}
            {formatMoney(invoice.amounts.overpayment, invoice.token, true)}{" "}
            {invoice.token}
            {tx(". Contact")} {invoice.issuer} {tx("to resolve it.")}
          </p>
        )}
        {invoice.voided ? (
          <p>
            {tx("Do not send further payments. Contact")} {invoice.issuer}{" "}
            {tx(
              "for an updated invoice. Payments already sent will still be tracked.",
            )}
          </p>
        ) : (
          invoice.amounts.remaining !== "0" && (
            <>
              <p>
                {tx("Send")}{" "}
                <strong>
                  {invoice.amounts.remaining} {invoice.token}
                </strong>{" "}
                {tx("on")} <strong>{getChainName(invoice.chainId)}</strong>
                {tx(
                  ". Use the exact currency and network shown. Other assets will not count toward this invoice.",
                )}
              </p>
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="self-start rounded-lg bg-white p-3">
                  <QRCodeSVG
                    value={invoice.receivingAddress!}
                    size={150}
                    title={tx("Invoice receiving address")}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="finance-label">
                    {tx("Invoice receiving address")}
                  </span>
                  <code className="block break-all text-sm">
                    {invoice.receivingAddress}
                  </code>
                  <button
                    className="workspace-button mt-3 print:hidden"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          invoice.receivingAddress!,
                        );
                        setCopied("Address copied.");
                      } catch {
                        setCopied(
                          "Could not copy. Select and copy the address above.",
                        );
                      }
                    }}
                  >
                    {tx("Copy address")}
                  </button>
                  <p role="status" className="mt-2 text-sm">
                    {copied}
                  </p>
                </div>
              </div>
              <details>
                <summary className="cursor-pointer text-sm">
                  {tx("Verify currency contract")}
                </summary>
                <code className="mt-2 block break-all text-sm">
                  {invoice.tokenAddress}
                </code>
              </details>
              <p className="text-sm text-slate-400">
                {tx(
                  "Your wallet or exchange may charge a network fee. Send the full remaining amount. We update this invoice after network confirmation; partial payments are supported.",
                )}
              </p>
            </>
          )
        )}
        {invoice.syncDelayed && (
          <p role="status">
            {tx(
              "Payment updates are delayed. If you already sent payment, do not send it again while confirmation is pending.",
            )}
          </p>
        )}
        <p className="text-xs text-slate-400">
          {invoice.lastCheckedAt
            ? tx("Last checked {{value1}}", {
                value1: new Date(invoice.lastCheckedAt).toLocaleString(
                  workspaceLocale(),
                ),
              })
            : tx("Waiting for the first network check.")}
        </p>
      </section>
      <p className="text-center text-sm text-slate-400">
        {tx("Payments powered by Disburse")}
      </p>
    </main>
  );
}
