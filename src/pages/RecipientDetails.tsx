import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import { userErrorMessage } from "@/lib/userErrors";
import { useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { Moon, Sun, CheckCircle2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { useTheme } from "@/lib/theme";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { assertValidAddress } from "../../shared/validation";
import { formatDate } from "@/lib/formatMoney";

function DetailsForm({ token }: { token: string }) {
  useWorkspaceLanguage();
  const validToken = /^[a-f0-9]{64}$/.test(token);
  const request = useQuery(
    api.recipientCollections.publicRequest,
    validToken ? { token } : "skip",
  );
  const submit = useMutation(api.recipientCollections.submit);
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState("");
  const [currency, setCurrency] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [received, setReceived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (validToken && request === undefined)
    return (
      <section className="workspace-panel p-6 space-y-4">
        <h1 className="text-2xl font-semibold">{tx("Payment details")}</h1>
        <p role="status">{tx("Loading your request…")}</p>
        <button
          className="workspace-button"
          onClick={() => window.location.reload()}
        >
          {tx("Reload request")}
        </button>
      </section>
    );
  if (!request || !request.options || !request.issuer)
    return (
      <section className="workspace-panel p-6 space-y-4">
        <h1 className="text-2xl font-semibold">
          {request?.state === "expired"
            ? tx("This link has expired")
            : tx("This link is unavailable")}
        </h1>
        <p className="text-slate-400">
          {tx(
            "Ask the business that contacted you for a new payment details link.",
          )}
        </p>
      </section>
    );
  if (received || request.state !== "requested")
    return (
      <section className="workspace-panel p-6 sm:p-8 space-y-4">
        <CheckCircle2
          className="text-accent-400"
          size={28}
          aria-hidden="true"
        />
        <h1 className="text-2xl font-semibold">
          {request.state === "approved"
            ? tx("Payment details approved")
            : ["rejected", "withdrawn"].includes(request.state)
              ? tx("Contact your finance team")
              : tx("Your details have been received")}
        </h1>
        <p className="text-slate-400">
          {request.state === "approved"
            ? tx("{{value1}} has reviewed your payment instructions.", {
                value1: request.issuer,
              })
            : ["rejected", "withdrawn"].includes(request.state)
              ? tx(
                  "{{value1}} needs to follow up on these instructions. Contact them through your usual channel before submitting another request.",
                  { value1: request.issuer },
                )
              : tx(
                  "{{value1}} will verify your details before using them for payment. They may contact you through a channel you already use.",
                  { value1: request.issuer },
                )}
        </p>
        <p className="text-sm">
          {tx("You can close this page. To change submitted details, ask")}{" "}
          {request.issuer} {tx("for a new link.")}
        </p>
      </section>
    );
  const network = request.options.find((n) => n.chainId === Number(chain));
  const asset = network?.tokens.find((t) => t.symbol === currency);
  const test = request.options.every((n) =>
    [11155111, 84532].includes(n.chainId),
  );
  const review = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      assertValidAddress(address.trim());
      if (/^0x0{40}$/i.test(address.trim()))
        throw new Error("Enter your receiving address, not the zero address.");
      if (!network || !asset)
        throw new Error("Choose your payment currency and network.");
      setReviewing(true);
      setConfirmed(false);
    } catch (e) {
      setError(userErrorMessage(e, "Check your payment details."));
    }
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      await submit({
        token,
        walletAddress: address.trim(),
        preferredChainId: Number(chain),
        preferredToken: currency,
        confirmed,
      });
      setReceived(true);
    } catch (e) {
      setError(
        userErrorMessage(
          e,
          "Your details could not be submitted. Try again using this link.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header className="space-y-2">
        <p className="workspace-eyebrow">
          {tx("Request from")} {request.issuer}
        </p>
        <h1 className="text-3xl font-semibold">
          {reviewing
            ? tx("Confirm your payment details")
            : tx("Where should we pay you?")}
        </h1>
        <p className="text-slate-400">
          {tx("For")} {request.recipientName} {tx("· Expires")}{" "}
          {formatDate(request.expiresAt)}
        </p>
      </header>
      {test && (
        <Notice tone="info">
          {tx("Test request · use an address for test funds only.")}
        </Notice>
      )}
      <section className="workspace-panel p-6 sm:p-8 space-y-6">
        {error && <Notice>{tx(error)}</Notice>}
        {reviewing ? (
          <form onSubmit={send} className="space-y-6">
            <dl className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <dt className="finance-label">{tx("Receiving address")}</dt>
                <dd className="break-all font-mono leading-7">
                  {address.trim()}
                </dd>
              </div>
              <div>
                <dt className="finance-label">{tx("Currency")}</dt>
                <dd className="font-semibold">{currency}</dd>
              </div>
              <div>
                <dt className="finance-label">{tx("Network")}</dt>
                <dd className="font-semibold">{network?.name}</dd>
              </div>
            </dl>
            <label className="flex items-start gap-3 text-sm leading-6">
              <input
                className="mt-1 shrink-0"
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {tx("I confirm this payment account is for")}{" "}
              {request.recipientName} {tx("and can receive")} {currency}{" "}
              {tx("on")} {network?.name}.
            </label>
            <p className="text-sm text-slate-400">
              {request.issuer}{" "}
              {tx("will review these instructions before making payments.")}
            </p>
            <div className="flex flex-wrap justify-between gap-3">
              <button
                type="button"
                className="workspace-button"
                disabled={busy}
                onClick={() => setReviewing(false)}
              >
                {tx("Edit details")}
              </button>
              <button
                className="workspace-button workspace-button-primary"
                disabled={busy || !confirmed}
              >
                {busy ? tx("Sending details…") : tx("Send details")}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={review} className="space-y-5">
            <p className="text-sm text-slate-400">
              {tx(
                "Choose the account where you want to receive payments. Use the receiving address from your wallet or payment provider.",
              )}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="finance-label">{tx("Payment network")}</span>
                <select
                  required
                  className="finance-field"
                  value={chain}
                  onChange={(e) => {
                    setChain(e.target.value);
                    setCurrency("");
                  }}
                >
                  <option value="">{tx("Choose network")}</option>
                  {request.options.map((n) => (
                    <option key={n.chainId} value={n.chainId}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="finance-label">{tx("Payment currency")}</span>
                <select
                  required
                  className="finance-field"
                  value={currency}
                  disabled={!network}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="">{tx("Choose currency")}</option>
                  {network?.tokens.map((t) => (
                    <option key={t.symbol}>{t.symbol}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="finance-label">{tx("Receiving address")}</span>
              <input
                className="finance-field font-mono text-sm"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={42}
                placeholder={tx("0x…")}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <p className="text-sm text-slate-400">
              {tx(
                "The network must match the one shown by your wallet or provider. If your preferred option is missing, contact",
              )}{" "}
              {request.issuer}.
            </p>
            {asset && (
              <details className="text-xs text-slate-400">
                <summary className="cursor-pointer">
                  {tx("Currency details")}
                </summary>
                <p className="mt-2">
                  {currency} {tx("contract on")} {network?.name}
                </p>
                <p className="mt-1 break-all font-mono">{asset.address}</p>
              </details>
            )}
            <button className="workspace-button workspace-button-primary w-full sm:w-auto">
              {tx("Review payment details")}
            </button>
          </form>
        )}
      </section>
      <p className="text-xs text-slate-400">
        {tx(
          "This form collects payment instructions. It does not connect to your wallet, request a password, or move funds.",
        )}
      </p>
    </>
  );
}

export default function RecipientDetails() {
  useWorkspaceLanguage();
  const { hash } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const token = hash.slice(1);
  return (
    <div className="workspace">
      <div className="mx-auto max-w-2xl px-5 py-7 sm:py-12">
        <header className="gap-3 flex-wrap mb-10 flex items-center justify-between">
          <span className="text-lg font-semibold">{tx("Disburse")}</span>
          <LanguageSwitcher inline />
          <button
            className="workspace-button"
            aria-label={
              theme === "light"
                ? tx("Switch to dark theme")
                : tx("Switch to light theme")
            }
            onClick={toggleTheme}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </header>
        <main className="space-y-6">
          <DetailsForm key={token} token={token} />
        </main>
      </div>
    </div>
  );
}
