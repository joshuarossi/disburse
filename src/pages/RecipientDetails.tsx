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
        <h1 className="text-2xl font-semibold">Payment details</h1>
        <p role="status">Loading your request…</p>
        <button
          className="workspace-button"
          onClick={() => window.location.reload()}
        >
          Reload request
        </button>
      </section>
    );
  if (!request || !request.options || !request.issuer)
    return (
      <section className="workspace-panel p-6 space-y-4">
        <h1 className="text-2xl font-semibold">
          {request?.state === "expired"
            ? "This link has expired"
            : "This link is unavailable"}
        </h1>
        <p className="text-slate-400">
          Ask the business that contacted you for a new payment details link.
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
            ? "Payment details approved"
            : ["rejected", "withdrawn"].includes(request.state)
              ? "Contact your finance team"
              : "Your details have been received"}
        </h1>
        <p className="text-slate-400">
          {request.state === "approved"
            ? `${request.issuer} has reviewed your payment instructions.`
            : ["rejected", "withdrawn"].includes(request.state)
              ? `${request.issuer} needs to follow up on these instructions. Contact them through your usual channel before submitting another request.`
              : `${request.issuer} will verify your details before using them for payment. They may contact you through a channel you already use.`}
        </p>
        <p className="text-sm">
          You can close this page. To change submitted details, ask{" "}
          {request.issuer} for a new link.
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
      setError(e instanceof Error ? e.message : "Check your payment details.");
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
        e instanceof Error
          ? e.message
          : "Your details could not be submitted. Try again using this link.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header className="space-y-2">
        <p className="workspace-eyebrow">Request from {request.issuer}</p>
        <h1 className="text-3xl font-semibold">
          {reviewing
            ? "Confirm your payment details"
            : "Where should we pay you?"}
        </h1>
        <p className="text-slate-400">
          For {request.recipientName} · Expires {formatDate(request.expiresAt)}
        </p>
      </header>
      {test && (
        <Notice tone="info">
          Test request · use an address for test funds only.
        </Notice>
      )}
      <section className="workspace-panel p-6 sm:p-8 space-y-6">
        {error && <Notice>{error}</Notice>}
        {reviewing ? (
          <form onSubmit={send} className="space-y-6">
            <dl className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <dt className="finance-label">Receiving address</dt>
                <dd className="break-all font-mono leading-7">
                  {address.trim()}
                </dd>
              </div>
              <div>
                <dt className="finance-label">Currency</dt>
                <dd className="font-semibold">{currency}</dd>
              </div>
              <div>
                <dt className="finance-label">Network</dt>
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
              I confirm this payment account is for {request.recipientName} and
              can receive {currency} on {network?.name}.
            </label>
            <p className="text-sm text-slate-400">
              {request.issuer} will review these instructions before making
              payments.
            </p>
            <div className="flex flex-wrap justify-between gap-3">
              <button
                type="button"
                className="workspace-button"
                disabled={busy}
                onClick={() => setReviewing(false)}
              >
                Edit details
              </button>
              <button
                className="workspace-button workspace-button-primary"
                disabled={busy || !confirmed}
              >
                {busy ? "Sending details…" : "Send details"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={review} className="space-y-5">
            <p className="text-sm text-slate-400">
              Choose the account where you want to receive payments. Use the
              receiving address from your wallet or payment provider.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="finance-label">Payment network</span>
                <select
                  required
                  className="finance-field"
                  value={chain}
                  onChange={(e) => {
                    setChain(e.target.value);
                    setCurrency("");
                  }}
                >
                  <option value="">Choose network</option>
                  {request.options.map((n) => (
                    <option key={n.chainId} value={n.chainId}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="finance-label">Payment currency</span>
                <select
                  required
                  className="finance-field"
                  value={currency}
                  disabled={!network}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="">Choose currency</option>
                  {network?.tokens.map((t) => (
                    <option key={t.symbol}>{t.symbol}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="finance-label">Receiving address</span>
              <input
                className="finance-field font-mono text-sm"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={42}
                placeholder="0x…"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <p className="text-sm text-slate-400">
              The network must match the one shown by your wallet or provider.
              If your preferred option is missing, contact {request.issuer}.
            </p>
            {asset && (
              <details className="text-xs text-slate-400">
                <summary className="cursor-pointer">Currency details</summary>
                <p className="mt-2">
                  {currency} contract on {network?.name}
                </p>
                <p className="mt-1 break-all font-mono">{asset.address}</p>
              </details>
            )}
            <button className="workspace-button workspace-button-primary w-full sm:w-auto">
              Review payment details
            </button>
          </form>
        )}
      </section>
      <p className="text-xs text-slate-400">
        This form collects payment instructions. It does not connect to your
        wallet, request a password, or move funds.
      </p>
    </>
  );
}

export default function RecipientDetails() {
  const { hash } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const token = hash.slice(1);
  return (
    <div className="workspace">
      <div className="mx-auto max-w-2xl px-5 py-7 sm:py-12">
        <header className="mb-10 flex items-center justify-between">
          <span className="text-lg font-semibold">Disburse</span>
          <button
            className="workspace-button"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
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
