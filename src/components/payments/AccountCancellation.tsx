import { supportsCircleFees } from '../../../shared/circleExecution';
import { userErrorMessage } from '@/lib/userErrors';
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { getBlockExplorerTxUrl } from "@/lib/chains";
import { RELAY_FEATURE_ENABLED } from "@/lib/relayConfig";
import { formatMoney } from "@/lib/formatMoney";
import { feeIdentity } from "../../../shared/executionFee";
import { Button } from "@/components/ui/button";
import { AccountChangeApproval } from "./AccountChangeApproval";

export function AccountCancellation({
  disbursementId,
  policyChangeId,
  memberName,
  initiallyOpen = false,
  onBack,
}: {
  disbursementId?: Id<"disbursements">;
  policyChangeId?: Id<"spendingPolicyChanges">;
  memberName: (wallet: string) => string;
  initiallyOpen?: boolean;
  onBack?: () => void;
}) {
  const sessionToken = useSessionToken()!;
  const source = { disbursementId, policyChangeId, sessionToken };
  const info = useQuery(
    api.accountCancellationData.get,
    sessionToken ? source : "skip",
  );
  const create = useAction(api.accountCancellations.create),
    load = useAction(api.accountCancellations.approvals),
    approve = useAction(api.accountCancellations.approve),
    execute = useAction(api.accountCancellations.execute);
  const walletResult = useMutation(api.accountCancellationData.walletResult),
    recheck = useMutation(api.accountCancellationData.recheck);
  const recoverOriginal = useAction(api.accountApprovals.recoverOriginal);
  const [open, setOpen] = useState(initiallyOpen),
    [legacyMethod, setMethod] = useState(
      RELAY_FEATURE_ENABLED ? "managed" : "wallet",
    ),
    [feeToken, setFeeToken] = useState("USDC");
  const [reviewedFee, setReviewedFee] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const circle = !!info && supportsCircleFees(info.chainId);
  const method = circle ? 'circle' : legacyMethod;
  const preparing = !info?.cancellation || retrying;
  const feeQuote = useQuery(
    api.spendingPolicyData.fee,
    info && open && method === "managed" && preparing
      ? { safeId: info.safeId, sessionToken, token: feeToken }
      : "skip",
  );
  const reviewKey =
    method === "managed"
      ? feeQuote?.fee
        ? feeIdentity(feeQuote.fee)
        : null
      : method;
  const reviewed = reviewKey !== null && reviewedFee === reviewKey;
  const setReviewed = (value: boolean) =>
    setReviewedFee(value ? reviewKey : null);
  const request = async () => {
    if (!info?.canRequest || !reviewed || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!info.originalAvailable && disbursementId)
        await recoverOriginal({ disbursementId, sessionToken });
      if (method === "managed" && !feeQuote?.fee)
        throw new Error("Review an available cancellation fee");
      await create({
        ...source,
        ...(method === "managed" && feeQuote?.fee
          ? { feeToken, reviewedFee: feeIdentity(feeQuote.fee) }
          : {}),
      });
      setReviewed(false);
      setRetrying(false);
    } catch (e) {
      setError(
        userErrorMessage(e, "Could not request cancellation"),
      );
    } finally {
      setBusy(false);
    }
  };
  if (!info)
    return initiallyOpen ? (
      <p role="status">Loading cancellation review…</p>
    ) : null;
  const c = info.cancellation;
  if (!c && !open)
    return info.canRequest ? (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Cancel policy request
      </Button>
    ) : null;
  const useCircle = circle && !!c && !c.executionFee && (!c.execution || c.execution.service === 'circle');
  const identity = c ? { cancellationId: c._id, sessionToken } : null;
  return (
    <section
      aria-label="Account cancellation"
      className={policyChangeId ? 'space-y-4 border-t border-[var(--ws-border)] pt-4' : 'space-y-4 rounded-lg border border-[var(--ws-border)] p-4'}
    >
      <div>
        <h3 className="font-semibold">
          {c?.status === "applied"
            ? "Cancellation confirmed"
            : c
              ? "Cancellation requested"
              : disbursementId
                ? "Cancel payment"
                : "Cancel policy request"}
        </h3>
        <p className="mt-2 text-sm text-[var(--ws-muted)]">
          {c?.status === "applied"
            ? "The account confirmed the cancellation. The original transaction can no longer execute."
            : "This request already has an account transaction reserved. Account approvers must authorize its cancellation. A network fee applies when cancellation is completed."}
        </p>
        {c && ["pending", "processing"].includes(c.status) && (
          <p className="mt-2 text-sm text-[var(--ws-muted)]">
            The original request is blocked in Disburse. Its budget remains
            reserved until cancellation is confirmed. The original transaction
            could still complete if it was submitted outside Disburse.
          </p>
        )}
      </div>
      {(error || c?.error) && (
        <p role="alert" className="text-sm text-red-400">
          {error || c?.error}
        </p>
      )}
      {preparing && info.canRequest && (
        <>
          <div className="space-y-3">
            {circle ? <p className="text-sm text-[var(--ws-muted)]">Your company account pays the cancellation fee in USDC. Review the exact limit after account approval. Recipients receive no payment from a cancellation.</p> : <>
            <label className="block">
              <span className="finance-label">Cancellation fee</span>
              <select
                className="finance-field"
                value={method}
                disabled={busy}
                onChange={(e) => {
                  setMethod(e.target.value);
                  setReviewed(false);
                }}
              >
                <option value="managed">Pay from company account</option>
                <option value="wallet">
                  Pay network fees from my signing wallet
                </option>
              </select>
            </label>
            {method === "managed" ? (
              <>
                <label className="block">
                  <span className="finance-label">Fee currency</span>
                  <select
                    className="finance-field"
                    value={feeToken}
                    disabled={busy}
                    onChange={(e) => {
                      setFeeToken(e.target.value);
                      setReviewed(false);
                    }}
                  >
                    <option>USDC</option>
                    <option>USDT</option>
                  </select>
                </label>
                {feeQuote?.fee ? (
                  <p className="text-sm">
                    {formatMoney(feeQuote.fee.amount, feeQuote.fee.token, true)}{" "}
                    {feeQuote.fee.token} from {info.safeName}, only when the
                    cancellation completes.
                  </p>
                ) : (
                  <p
                    role={feeQuote ? "alert" : "status"}
                    className="text-sm text-[var(--ws-muted)]"
                  >
                    {feeQuote?.error ?? "Checking the cancellation fee…"}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--ws-muted)]">
                Your wallet shows the network fee before you send the
                cancellation. No payment is sent to the original recipients.
              </p>
            )}
            </>}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            <span>
              I reviewed the cancellation and its fee. The original request is
              cancelled only after account confirmation.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={
                busy || !reviewed || (method === "managed" && !feeQuote?.fee)
              }
              onClick={() => void request()}
            >
              {busy
                ? "Preparing cancellation…"
                : "Request cancellation approval"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setRetrying(false);
                onBack?.();
              }}
            >
              Keep original request
            </Button>
          </div>
        </>
      )}
      {c?.status === "failed" &&
        !["applied", "executed", "failed", "cancelled"].includes(
          info.originalStatus,
        ) &&
        info.canRequest &&
        !retrying && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setRetrying(true);
              setOpen(true);
              setReviewed(false);
            }}
          >
            Review another cancellation attempt
          </Button>
        )}
      {c && identity && (
        <>
          <p className="text-sm text-[var(--ws-muted)]">
            {c.executionFee
              ? `Cancellation fee: ${formatMoney(c.executionFee.amount, c.executionFee.token, true)} ${c.executionFee.token} from this account.`
              : useCircle ? 'The company account pays the reviewed cancellation fee in USDC.' : "Network fee paid from the signing wallet when cancellation is completed."}
          </p>
          <AccountChangeApproval
            key={c._id}
            subject="cancellation"
            recordKey={c._id}
            status={c.status}
            chainId={c.chainId}
            updatedAt={c.updatedAt}
            managed={!!c.executionFee}
            feeSource={useCircle ? { cancellationId: c._id } : undefined}
            walletRejectedAt={c.execution?.walletRejectedAt}
            txHash={c.execution?.txHash}
            canApprove={info.canApprove}
            canCheck={info.canRequest}
            memberName={memberName}
            reviewText="I reviewed the original request and cancellation fee. I approve cancelling this account transaction."
            load={() => load(identity)}
            approve={(args) => approve({ ...identity, ...args })}
            execute={() => execute(identity)}
            walletResult={(args) => walletResult({ ...identity, ...args })}
            recheck={() => recheck(identity)}
          />
          {(c.txHash || c.execution?.txHash) && (
            <a
              className="inline-block text-sm text-[var(--ws-accent)]"
              target="_blank"
              rel="noreferrer"
              href={getBlockExplorerTxUrl(
                c.chainId,
                (c.txHash ?? c.execution?.txHash)!,
              )}
            >
              View cancellation receipt
            </a>
          )}
        </>
      )}
    </section>
  );
}
