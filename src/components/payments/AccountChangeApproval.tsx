import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import {
  signAccountApproval,
  sendApprovedAccountPayment,
} from "@/lib/accountApproval";
import { walletDeclined } from "@/lib/walletErrors";
import { ApprovalPathReview } from "@/features/payments/ApprovalPathReview";
import { Button } from "@/components/ui/button";
import type { AccountApprovalView } from "../../../shared/accountApprovalView";

type Prepared = {
  to: string;
  data: string;
  attemptId: string;
  managed: boolean;
};
/** One wallet interaction for policy changes and cancellation. Both preserve the
 * prepared attempt on response loss and retry only an explicit wallet decline. */
export function AccountChangeApproval({
  subject,
  chainId,
  status,
  updatedAt,
  recordKey,
  revision = 0,
  managed,
  walletRejectedAt,
  txHash,
  canApprove,
  canCheck = canApprove,
  reviewText,
  memberName,
  load,
  approve,
  execute,
  walletResult,
  recheck,
}: {
  subject: "policy" | "cancellation";
  chainId: number;
  status: string;
  updatedAt: number;
  recordKey: string;
  revision?: number;
  managed: boolean;
  walletRejectedAt?: number;
  txHash?: string;
  canApprove: boolean;
  canCheck?: boolean;
  reviewText: string;
  memberName: (address: string) => string;
  load: () => Promise<AccountApprovalView>;
  approve: (args: {
    safeTxHash: string;
    path: string[];
    signature: string;
  }) => Promise<unknown>;
  execute: () => Promise<Prepared>;
  walletResult: (args: {
    attemptId: string;
    txHash?: string;
    rejected?: boolean;
  }) => Promise<unknown>;
  recheck: () => Promise<unknown>;
}) {
  const { address, chainId: connectedChain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const retryable =
    status === "processing" && !!walletRejectedAt && !txHash && !managed;
  const reviewable = status === "pending" || retryable;
  const approvals = useQuery({
    queryKey: [
      "account-change-approvals",
      recordKey,
      updatedAt,
      address,
      revision,
    ],
    queryFn: load,
    enabled: reviewable,
    refetchInterval: 15000,
    retry: 1,
  });
  const [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [pathRequest, setPathRequest] = useState<AccountApprovalView | null>(
    null,
  );
  const prepareWallet = async () => {
    if (!address) throw new Error("Connect your approver wallet");
    if (connectedChain !== chainId) await switchChainAsync({ chainId });
  };
  const sign = async (request: AccountApprovalView, path: string[]) => {
    await prepareWallet();
    const signature = await signAccountApproval(
      chainId,
      address!,
      request.proposal,
      path,
    );
    await approve({ safeTxHash: request.proposal.safeTxHash, path, signature });
    setPathRequest(null);
    setMessage(`Your ${subject} approval is saved.`);
    setReviewed(false);
    await approvals.refetch();
  };
  const act = async (
    operation: "approve" | "apply" | "recheck",
    path?: string[],
  ) => {
    if (
      busy ||
      (operation === "recheck" ? !canCheck : !canApprove || !reviewed)
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (operation === "recheck") {
        await recheck();
        await approvals.refetch();
        setMessage(`Checking the original ${subject} submission.`);
        return;
      }
      if (operation === "approve") {
        if (pathRequest && path) {
          await sign(pathRequest, path);
          return;
        }
        const fresh = await load();
        if (fresh.blockedReason) throw new Error(fresh.blockedReason);
        const available = fresh.paths.filter((p) => !p.approved);
        if (!available.length)
          throw new Error(
            "No additional approval is needed from your current wallet",
          );
        if (available.length > 1 || available[0].path.length > 1) {
          setPathRequest({ ...fresh, paths: available });
          return;
        }
        await sign(fresh, available[0].path);
      } else {
        await prepareWallet();
        const prepared = await execute();
        if (!prepared.managed) {
          let hash: string;
          try {
            hash = await sendApprovedAccountPayment(
              chainId,
              address!,
              prepared,
            );
          } catch (e) {
            if (walletDeclined(e)) {
              await walletResult({
                attemptId: prepared.attemptId,
                rejected: true,
              });
              throw new Error(
                `Wallet approval declined. Your ${subject} and account approvals are saved. You can retry this original request.`,
              );
            }
            throw new Error(
              `The wallet response was interrupted. Check the original ${subject} submission before trying again.`,
            );
          }
          await walletResult({ attemptId: prepared.attemptId, txHash: hash });
        }
        setMessage(
          `${subject === "policy" ? "Policy" : "Cancellation"} submitted. We are checking its confirmation.`,
        );
      }
    } catch (e) {
      setError(
        walletDeclined(e)
          ? "Wallet approval declined. No approval was added."
          : e instanceof Error
            ? e.message
            : `Could not update this ${subject}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const name = (wallet: string) =>
    approvals.data?.names.find((n) => n.address === wallet.toLowerCase())
      ?.name ?? memberName(wallet);
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-[var(--ws-accent)]">
          {message}
        </p>
      )}
      {reviewable &&
        (approvals.isPending ? (
          <p role="status" className="text-sm text-[var(--ws-muted)]">
            Checking account approvals…
          </p>
        ) : approvals.isError ? (
          <div role="alert" className="text-sm">
            <p>Could not verify account approvals.</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void approvals.refetch()}
            >
              Retry approval check
            </Button>
          </div>
        ) : (
          approvals.data && (
            <>
              {approvals.data.blockedReason && (
                <p role="alert" className="text-sm text-amber-500">
                  {approvals.data.blockedReason}
                </p>
              )}
              {approvals.data.groups.map((group) => (
                <div
                  key={group.path.join(":")}
                  className="rounded-lg border border-[var(--ws-border)] p-3"
                >
                  <p className="text-sm font-medium">
                    {name(group.address)} · {group.confirmedOwners.length} of{" "}
                    {group.threshold} approvals
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-[var(--ws-muted)]">
                    {group.owners.map((owner) => (
                      <li className="break-all" key={owner}>
                        {name(owner)} ·{" "}
                        {group.confirmedOwners.includes(owner)
                          ? "Approved"
                          : "Awaiting approval"}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {approvals.data.currentNonce <
                approvals.data.proposal.safeTransactionData.nonce && (
                <p className="text-sm text-amber-500">
                  An earlier payment or account change must complete first.
                </p>
              )}
              {canApprove && !approvals.data.blockedReason && (
                <>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={busy}
                      onChange={(e) => {
                        setReviewed(e.target.checked);
                        if (!e.target.checked) setPathRequest(null);
                      }}
                    />
                    <span>{reviewText}</span>
                  </label>
                  {pathRequest ? (
                    <ApprovalPathReview
                      subject={subject}
                      paths={pathRequest.paths}
                      busy={busy}
                      onApprove={(path) => void act("approve", path)}
                      onCancel={() => setPathRequest(null)}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {status === "pending" &&
                        approvals.data.paths.some((p) => !p.approved) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || !reviewed}
                            onClick={() => void act("approve")}
                          >
                            {busy
                              ? "Waiting for wallet…"
                              : `Approve ${subject}`}
                          </Button>
                        )}
                      <Button
                        size="sm"
                        disabled={busy || !reviewed || !approvals.data.ready}
                        onClick={() => void act("apply")}
                      >
                        {busy
                          ? "Processing…"
                          : retryable
                            ? `Retry original ${subject}`
                            : subject === "policy"
                              ? "Apply policy"
                              : "Complete cancellation"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )
        ))}
      {(status === "processing" ||
        (subject === "cancellation" && status === "pending")) &&
        canCheck && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void act("recheck")}
          >
            Check {subject} confirmation
          </Button>
        )}
    </div>
  );
}
