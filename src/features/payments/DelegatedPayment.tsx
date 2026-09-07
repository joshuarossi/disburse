import { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { RELAY_FEATURE_ENABLED } from "@/lib/relayConfig";
import { sendApprovedAccountPayment } from "@/lib/accountApproval";
import { walletDeclined, walletErrorMessage } from "@/lib/walletErrors";
import type { FunctionReturnType } from "convex/server";
import { useAccount, useSwitchChain } from "wagmi";
import { formatUnits } from "viem";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/formatMoney";
import { signAllowanceAuthorization } from "@/lib/delegatedTransfer";

type AllowanceQuote = FunctionReturnType<typeof api.delegatedPayments.quote>;
export function DelegatedPayment({
  payment,
  blocked,
  onBusyChange,
  onModeChange,
  onFeeModeChange,
}: {
  payment: Doc<"disbursements">;
  blocked: boolean;
  onBusyChange: (value: boolean) => void;
  onModeChange: (value: boolean) => void;
  onFeeModeChange: (mode: "managed" | "wallet") => void;
}) {
  const sessionToken = useSessionToken();
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const getQuote = useAction(api.delegatedPayments.quote);
  const prepare = useAction(api.delegatedPayments.prepare);
  const record = useAction(api.delegatedPayments.recordSubmission);
  const startNative = useAction(api.delegatedNative.start);
  const walletRejected = useMutation(api.nativePayments.walletRejected);
  const [feeMode, setFeeMode] = useState<"managed" | "wallet">(
    RELAY_FEATURE_ENABLED ? "managed" : "wallet",
  );
  const operationLock = useRef(false);
  const reviewContext = `${payment._id}:${payment.updatedAt}:${address?.toLowerCase()}:${feeMode}`;
  const currentContext = useRef(reviewContext);
  currentContext.current = reviewContext;
  const [quoteContext, setQuoteContext] = useState("");
  const [storedQuote, setQuote] = useState<AllowanceQuote | null>(null);
  const quote = quoteContext === reviewContext ? storedQuote : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reservedPaymentId, setReservedPaymentId] = useState<string>();
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState(payment.txHash ?? "");
  const [acknowledgedContext, setAcknowledgedContext] = useState("");
  const acknowledged = acknowledgedContext === reviewContext;
  const setAcknowledged = (value: boolean) =>
    setAcknowledgedContext(value ? reviewContext : "");
  const isDelegate =
    !payment.allowanceExecution ||
    payment.allowanceExecution.delegate.toLowerCase() ===
      address?.toLowerCase();
  const run = async (operation: "quote" | "pay" | "record") => {
    if (
      !sessionToken ||
      operationLock.current ||
      (blocked && operation !== "record")
    )
      return;
    operationLock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setReservedPaymentId(undefined);
    setMessage("");
    let confirmingWallet = false;
    try {
      const args = { disbursementId: payment._id, sessionToken };
      if (operation === "quote") {
        setQuote(null);
        setAcknowledged(false);
        const nextQuote = await getQuote({ ...args, feeMode });
        if (nextQuote.delegate.toLowerCase() !== address?.toLowerCase())
          throw new Error(
            "The connected member changed. Check your allowance again.",
          );
        setQuote(nextQuote);
        setQuoteContext(reviewContext);
        return;
      }
      if (operation === "record") {
        await record({ ...args, txHash: txHash.trim() });
        setMessage("Receipt linked. Settlement is being verified.");
        return;
      }
      if (!acknowledged || !payment.chainId || !isDelegate) return;
      if (chainId !== payment.chainId) {
        confirmingWallet = true;
        await switchChainAsync({ chainId: payment.chainId });
        confirmingWallet = false;
      }
      let intent = payment.allowanceExecution;
      if (!intent) {
        if (!quote) return;
        const sign = async (hash: string) => {
          if (currentContext.current !== reviewContext)
            throw new Error(
              "The payment or connected member changed. Review the allowance again.",
            );
          confirmingWallet = true;
          const signature = await signAllowanceAuthorization(
            quote.chainId,
            quote.delegate,
            hash,
          );
          confirmingWallet = false;
          if (currentContext.current !== reviewContext)
            throw new Error(
              "The payment or connected member changed. Review the allowance again.",
            );
          return signature;
        };
        const signature = await sign(quote.hash);
        const additionalSignatures = [];
        for (const transfer of quote.additionalTransfers ?? [])
          additionalSignatures.push(await sign(transfer.hash));
        const feeSignature = quote.feeHash
          ? await sign(quote.feeHash)
          : undefined;
        intent = await prepare({
          ...args,
          feeMode,
          hash: quote.hash,
          signature,
          feeHash: quote.feeHash,
          feeSignature,
          additionalSignatures,
        });
      }
      if (!intent.feeAuthorization) {
        const prepared = await startNative(args);
        let hash: string;
        try {
          hash = await sendApprovedAccountPayment(
            payment.chainId,
            address!,
            prepared,
          );
        } catch (error) {
          if (walletDeclined(error)) {
            await walletRejected({ ...args, attemptId: prepared.attemptId });
            setMessage(
              "Wallet approval declined. The original allowance authorization is saved. Review it again to retry.",
            );
            return;
          }
          throw new Error(
            "The wallet response was interrupted. Check the original payment settlement before trying again.",
          );
        }
        setTxHash(hash);
        await record({ ...args, txHash: hash });
      }
      setMessage(
        "Payment submitted. We will verify settlement before marking it paid.",
      );
    } catch (error) {
      if (error instanceof ConvexError && error.data?.code === 'ALLOWANCE_AUTHORIZATION_RESERVED') {
        setError(error.data.message);
        setReservedPaymentId(error.data.disbursementId);
      }
      else if (confirmingWallet && walletDeclined(error)) setMessage(walletErrorMessage(error, ''));
      else {
        const fallback = "Could not complete this payment. Check its status before trying again.";
        setError(walletDeclined(error) ? fallback : walletErrorMessage(error, fallback));
      }
    } finally {
      operationLock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <details
      className="rounded-lg border border-white/10 p-4"
      open={!!payment.allowanceExecution}
      onToggle={(event) => onModeChange(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-medium">
        Pay with a spending allowance
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-slate-400">
          An authorized member can pay these recipients within their account
          allowance, without collecting owner approvals for this payment.
        </p>
        {error && (
          <p role="alert" className="min-w-0 break-words text-sm text-red-400">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-accent-400">
            {message}
          </p>
        )}
        {reservedPaymentId && <a className="text-sm text-accent-400 underline" href={`/org/${payment.orgId}/disbursements?focus=${encodeURIComponent(reservedPaymentId)}`}>Open the original payment</a>}
        {!payment.allowanceExecution && (
          <label className="block">
            <span className="finance-label">Execution fee</span>
            <select
              className="finance-field"
              value={feeMode}
              disabled={busy}
              onChange={(e) => {
                setFeeMode(e.target.value as "managed" | "wallet");
                onFeeModeChange(e.target.value as "managed" | "wallet");
                setQuote(null);
                setAcknowledged(false);
              }}
            >
              <option value="managed">Pay from company account</option>
              <option value="wallet">
                Pay network fees from my signing wallet
              </option>
            </select>
          </label>
        )}
        {!payment.allowanceExecution && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || blocked}
            onClick={() => void run("quote")}
          >
            Check my allowance
          </Button>
        )}
        {quote && !payment.allowanceExecution && (
          <p className="text-sm">
            Available allowance:{" "}
            {formatMoney(
              formatUnits(BigInt(quote.available), 6),
              payment.token,
              true,
            )}{" "}
            {payment.token}
          </p>
        )}
        {quote && (
          <p className="text-xs text-slate-400">
            Your wallet will request{" "}
            {(quote.additionalTransfers?.length ?? 0) + 1 + (quote.fee ? 1 : 0)}{" "}
            {(quote.additionalTransfers?.length ?? 0) +
              1 +
              (quote.fee ? 1 : 0) ===
            1
              ? "signature"
              : "signatures"}{" "}
            to authorize the recipient amounts
            {quote.fee ? " and a separate fee" : ""}.{" "}
            {quote.additionalTransfers?.length
              ? "Recipients are paid together in one transaction."
              : ""}
          </p>
        )}
        {(quote ||
          (payment.allowanceExecution &&
            !payment.allowanceExecution.feeAuthorization &&
            (!payment.nativeExecution?.attemptId ||
              payment.nativeExecution.walletRejectedAt ||
              payment.nativeExecution.revertedAt))) &&
          !payment.txHash &&
          isDelegate && (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  {quote?.fee
                    ? `Send this payment now using my allowance, including a ${quote.fee.amount} ${quote.fee.token} fee from the funding account. Recipient amounts stay unchanged.`
                    : "Send the saved recipient amounts using my allowance. My signing wallet pays the network fee and shows its estimate before sending."}
                </span>
              </label>
              <Button
                disabled={busy || blocked || !acknowledged}
                onClick={() => void run("pay")}
              >
                {busy
                  ? "Processing…"
                  : payment.allowanceExecution
                    ? "Retry original allowance payment"
                    : "Pay using allowance"}
              </Button>
              <p className="text-xs text-slate-400">
                This authorization is bound to the saved recipient and amount
                and cannot be reused after settlement.
              </p>
            </>
          )}
        {(payment.allowanceExecution || txHash) && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              If this payment settled but its status has not updated, link its
              receipt to reconcile the same authorization.
            </p>
            <label className="block">
              <span className="finance-label">Delegated payment receipt</span>
              <input
                className="finance-field font-mono text-xs"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="0x transaction hash"
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !txHash}
              onClick={() => void run("record")}
            >
              Link receipt
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
