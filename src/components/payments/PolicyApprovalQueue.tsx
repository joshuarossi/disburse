import { useEffect, useRef, useState } from "react";
import {
  useAction,
  useMutation,
  useQuery as useConvexQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { ALLOWANCE_PERIODS } from "@/lib/safeAllowance";
import { getTokensForChain, getBlockExplorerTxUrl } from "@/lib/chains";
import { formatMoney } from "@/lib/formatMoney";
import { AccountChangeApproval } from "./AccountChangeApproval";
import { AccountCancellation } from "./AccountCancellation";
import { Button } from "@/components/ui/button";

type PolicyRow = FunctionReturnType<
  typeof api.spendingPolicyData.list
>["proposals"][number];
export function PolicyApprovalQueue({
  safeId,
  memberName,
  onExecuted,
}: {
  safeId: Id<"safes">;
  memberName: (wallet: string) => string;
  onExecuted: () => void;
}) {
  const sessionToken = useSessionToken();
  const queue = useConvexQuery(
    api.spendingPolicyData.list,
    sessionToken ? { safeId, sessionToken } : "skip",
  );
  const [revision, setRevision] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const applied = queue?.proposals
    .filter((p) => p.status === "applied")
    .map((p) => p._id)
    .join(":");
  const refreshed = useRef<string | undefined>(undefined),
    refreshSnapshot = useRef(onExecuted);
  refreshSnapshot.current = onExecuted;
  useEffect(() => {
    if (applied !== undefined && applied !== refreshed.current) {
      refreshed.current = applied;
      refreshSnapshot.current();
    }
  }, [applied]);
  const pending = queue?.proposals.filter((p) =>
    ["pending", "processing"].includes(p.status),
  );
  const history = queue?.proposals.filter(
    (p) => !["pending", "processing"].includes(p.status),
  );
  return (
    <section
      aria-label="Policy approvals"
      className="space-y-4 rounded-lg border border-[var(--ws-border)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Policy approvals</h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setRevision((n) => n + 1);
            onExecuted();
          }}
        >
          Refresh policies
        </Button>
      </div>
      {!queue ? (
        <p role="status" className="text-sm text-[var(--ws-muted)]">
          Loading policy requests…
        </p>
      ) : (
        <>
          {!pending?.length && (
            <p className="text-sm text-[var(--ws-muted)]">
              No spending-policy changes are awaiting approval.
            </p>
          )}
          {pending?.map((policy) => (
            <PolicyCard
              key={policy._id}
              policy={policy}
              memberName={memberName}
              canApprove={queue.canApprove}
              revision={revision}
            />
          ))}
          {!!history?.length && (
            <>
              <button
                className="text-sm text-[var(--ws-accent)]"
                aria-expanded={showHistory}
                onClick={() => setShowHistory((v) => !v)}
              >
                {showHistory
                  ? "Hide recent policy changes"
                  : "View recent policy changes"}
              </button>
              {showHistory &&
                history.map((policy) => (
                  <PolicyCard
                    key={policy._id}
                    policy={policy}
                    memberName={memberName}
                    canApprove={false}
                    revision={revision}
                  />
                ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
function PolicyCard({
  policy: p,
  memberName,
  canApprove,
  revision,
}: {
  policy: PolicyRow;
  memberName: (wallet: string) => string;
  canApprove: boolean;
  revision: number;
}) {
  const sessionToken = useSessionToken()!;
  const getApprovals = useAction(api.spendingPolicies.approvals),
    approve = useAction(api.spendingPolicies.approve),
    execute = useAction(api.spendingPolicies.execute);
  const recordBroadcast = useMutation(api.spendingPolicyData.recordBroadcast),
    rejected = useMutation(api.spendingPolicyData.walletRejected),
    recheck = useMutation(api.spendingPolicyData.recheck);
  const identity = { policyChangeId: p._id, sessionToken };
  const retryable =
    p.status === "processing" &&
    !!p.execution?.walletRejectedAt &&
    !p.execution.txHash &&
    !p.executionFee;
  const token = Object.values(getTokensForChain(p.chainId)).find(
    (t) => t.address.toLowerCase() === p.intent.tokenAddress.toLowerCase(),
  );
  return (
    <article
      aria-label={`${p.intent.kind === "grant" ? "Set allowance" : "Revoke allowance"} for ${memberName(p.intent.delegate)}`}
      className="space-y-3 rounded-lg bg-[var(--ws-surface)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="font-medium">
          {p.status === "applied"
            ? p.intent.kind === "grant"
              ? "Allowance set"
              : "Allowance revoked"
            : p.intent.kind === "grant"
              ? "Set allowance"
              : "Revoke allowance"}{" "}
          · {memberName(p.intent.delegate)}
        </h4>
        <span className="text-xs text-[var(--ws-muted)]">
          {p.cancellationId &&
          !p.cancellationConfirmedAt &&
          p.status !== "applied"
            ? "Cancellation requested"
            : p.status === "cancelled"
              ? "Cancelled"
              : p.status === "applied"
                ? "Applied"
                : p.status === "failed"
                  ? "Failed"
                  : retryable
                    ? "Ready to retry"
                    : p.status === "processing"
                      ? "Checking confirmation"
                      : "Needs approval"}
        </span>
      </div>
      {p.appliedAt && (
        <time
          className="block text-xs text-[var(--ws-muted)]"
          dateTime={new Date(p.appliedAt).toISOString()}
        >
          {new Date(p.appliedAt).toLocaleString()}
        </time>
      )}
      <p className="text-sm">
        {p.intent.kind === "grant" && p.intent.amount && token
          ? `${formatMoney(p.intent.amount, token.symbol, true)} ${token.symbol}`
          : (token?.symbol ?? `Currency contract: ${p.intent.tokenAddress}`)}
        {p.intent.kind === "grant" &&
          ` · ${ALLOWANCE_PERIODS.find((period) => period.minutes === p.intent.resetMinutes)?.label ?? "Custom interval"}`}
      </p>
      {p.intent.kind === "grant" &&
        !p.cancellationId &&
        p.status !== "applied" && (
          <p className="text-xs text-[var(--ws-muted)]">
            Spending already used in the current interval is retained. This
            allowance permits transfers to any address.
          </p>
        )}
      {!p.intent.moduleEnabled &&
        p.intent.kind === "grant" &&
        !p.cancellationId &&
        p.status !== "applied" && (
          <p className="text-sm text-amber-500">
            This also activates delegated spending for this account.
          </p>
        )}
      {!p.cancellationId && (
        <p className="text-xs text-[var(--ws-muted)]">
          {p.executionFee
            ? `Execution fee: ${formatMoney(p.executionFee.amount, p.executionFee.token, true)} ${p.executionFee.token} from this account.`
            : "Network fee paid from the signing wallet when the policy is applied."}
        </p>
      )}
      {p.error && (
        <p role="alert" className="text-sm text-red-400">
          {p.error}
        </p>
      )}
      {!p.cancellationId && (
        <AccountChangeApproval
          subject="policy"
          chainId={p.chainId}
          recordKey={p._id}
          status={p.status}
          updatedAt={p.updatedAt}
          revision={revision}
          managed={!!p.executionFee}
          walletRejectedAt={p.execution?.walletRejectedAt}
          txHash={p.execution?.txHash}
          canApprove={canApprove}
          memberName={memberName}
          reviewText="I reviewed this member’s spending authority and the execution fee. The policy changes only after it is applied."
          load={() => getApprovals(identity)}
          approve={(args) => approve({ ...identity, ...args })}
          execute={() => execute(identity)}
          recheck={() => recheck(identity)}
          walletResult={(args) =>
            args.rejected
              ? rejected({ ...identity, attemptId: args.attemptId })
              : recordBroadcast({
                  ...identity,
                  attemptId: args.attemptId,
                  txHash: args.txHash!,
                })
          }
        />
      )}
      {(p.cancellationId || p.status === "pending") && (
        <AccountCancellation policyChangeId={p._id} memberName={memberName} />
      )}
      {(p.txHash || p.execution?.txHash) && (
        <a
          className="inline-block text-sm text-[var(--ws-accent)]"
          target="_blank"
          rel="noreferrer"
          href={getBlockExplorerTxUrl(
            p.chainId,
            (p.txHash ?? p.execution?.txHash)!,
          )}
        >
          View transaction receipt
        </a>
      )}
    </article>
  );
}
