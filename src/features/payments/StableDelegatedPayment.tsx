import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { userErrorMessage } from "@/lib/userErrors";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { CustomerPaidExecution } from "./CustomerPaidExecution";

type Quote = FunctionReturnType<typeof api.delegatedPayments.quote>;
export function StableDelegatedPayment({
  payment,
  blocked,
  onBusyChange,
  onModeChange,
}: {
  payment: Doc<"disbursements">;
  blocked: boolean;
  onBusyChange: (busy: boolean) => void;
  onModeChange: (open: boolean) => void;
}) {
  const sessionToken = useSessionToken(),
    { address } = useAccount();
  const accounts = useQuery(
    api.delegatedCircle.feeAccounts,
    sessionToken ? { disbursementId: payment._id, sessionToken } : "skip",
  );
  const stop = useMutation(api.delegatedCircle.stop);
  const getQuote = useAction(api.delegatedPayments.quote),
    prepare = useAction(api.delegatedPayments.prepare);
  const [selected, setSelected] = useState<string>(""),
    [stored, setStored] = useState<{ key: string; quote: Quote }>(),
    [busy, setBusy] = useState(false),
    [executionBusy, setExecutionBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reservation, setReservation] = useState<string>();
  const feeId =
    (payment.allowanceFeeSafeId ?? selected) ||
    accounts?.find((s) => s.likelyOwner)?.id ||
    accounts?.[0]?.id;
  const key = `${payment._id}:${payment.updatedAt}:${address?.toLowerCase()}:${feeId}`;
  const current = useRef(key);
  current.current = key;
  const lock = useRef(false),
    quote = stored?.key === key ? stored.quote : undefined;
  const run = async (mode: "quote" | "authorize") => {
    if (!sessionToken || !feeId || lock.current || blocked) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setNotice("");
    setReservation(undefined);
    try {
      const args = {
        disbursementId: payment._id,
        sessionToken,
        feeMode: "stablecoin" as const,
        feeSafeId: feeId as Id<"safes">,
      };
      if (mode === "quote") {
        setStored(undefined);
        const result = await getQuote(args);
        if (
          current.current !== key ||
          result.delegate.toLowerCase() !==
            accounts?.find((s) => s.id === feeId)?.address.toLowerCase()
        )
          throw new Error(
            "The member or payment changed. Review your allowance again.",
          );
        setStored({ key, quote: result });
      } else {
        if (!quote) return;
        await prepare({
          ...args,
          hash: quote.hash,
          signature: "0x",
          additionalSignatures: quote.additionalTransfers.map(() => "0x"),
        });
        setNotice(
          "Allowance instructions saved. Review the USDC fee and account approval next.",
        );
      }
    } catch (e) {
      setError(
        userErrorMessage(
          e,
          "Could not prepare this allowance payment. Check its saved status before trying again.",
        ),
      );
      if (
        e instanceof ConvexError &&
        e.data?.code === "ALLOWANCE_AUTHORIZATION_RESERVED"
      )
        setReservation(e.data.disbursementId);
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <details
      className="workspace-card p-4"
      open={!!payment.allowanceExecution}
      onToggle={(e) => onModeChange(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">
        Pay with a spending allowance
      </summary>
      <div className="mt-4 space-y-4">
        <p className="workspace-description">
          Use your approved spending limit for the saved recipient amounts. Your
          assigned payment account approves the batch and pays gas in USDC.
        </p>
        {error && <Notice>{error}</Notice>}
        {notice && <Notice tone="info">{notice}</Notice>}
        {reservation && (
          <a
            className="workspace-link"
            href={`/org/${payment.orgId}/disbursements?focus=${encodeURIComponent(reservation)}`}
          >
            Open the original allowance payment
          </a>
        )}
        {payment.allowanceExecution ? (
          <>
            <p className="workspace-description">
              Fee account:{" "}
              <strong>
                {accounts?.find((s) => s.id === feeId)?.name ??
                  "Saved fee account"}
              </strong>
              . Recipient amounts and the original allowance authorization stay
              unchanged.
            </p>
            {payment.allowanceCancellationRequestedAt &&
            payment.allowanceCircleExecutionId ? (
              <>
                {payment.status !== "cancelled" && (
                  <Notice tone="info">
                    The original request is paused in Disburse. Complete the
                    cancellation below to invalidate its signed authorization
                    on-chain.
                  </Notice>
                )}
                <CustomerPaidExecution
                  source={{
                    cancelExecutionId: payment.allowanceCircleExecutionId,
                  }}
                  ready={payment.status === "relaying"}
                  blocked={busy}
                  memberName={(wallet) => wallet}
                  onBusyChange={(value) => {
                    setExecutionBusy(value);
                    onBusyChange(value);
                  }}
                />
              </>
            ) : (
              <CustomerPaidExecution
                source={{ delegatedDisbursementId: payment._id }}
                ready={payment.status === "relaying" && !payment.txHash}
                blocked={blocked || busy}
                memberName={(wallet) => wallet}
                onBusyChange={(value) => {
                  setExecutionBusy(value);
                  onBusyChange(value);
                }}
              />
            )}
            {payment.status === "relaying" &&
              !payment.txHash &&
              !payment.allowanceCancellationRequestedAt && (
                <button
                  className="workspace-button"
                  disabled={busy || executionBusy}
                  onClick={async () => {
                    if (!sessionToken || lock.current) return;
                    lock.current = true;
                    setBusy(true);
                    onBusyChange(true);
                    setError("");
                    try {
                      await stop({ disbursementId: payment._id, sessionToken });
                    } catch (e) {
                      setError(
                        userErrorMessage(
                          e,
                          "Could not cancel this payment. Check its original status.",
                        ),
                      );
                    } finally {
                      lock.current = false;
                      setBusy(false);
                      onBusyChange(false);
                    }
                  }}
                >
                  Cancel allowance payment
                </button>
              )}
            {!payment.txHash && (
              <p className="workspace-description">
                You can discard an unsigned payment without a charge. A signed
                payment requires a separately reviewed USDC-paid cancellation.
                Company owners can also revoke the account’s spending allowance.
              </p>
            )}
          </>
        ) : (
          <>
            <label className="block">
              <span className="finance-label">My payment account</span>
              <select
                className="finance-field"
                value={feeId ?? ""}
                disabled={busy || !accounts?.length}
                onChange={(e) => setSelected(e.target.value)}
              >
                {!accounts?.length && (
                  <option value="">
                    {accounts === undefined
                      ? "Loading accounts…"
                      : "No supported fee account"}
                  </option>
                )}
                {accounts?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {accounts?.length === 0 && (
              <Notice tone="info">
                An administrator can assign you a payment account in Settings →
                Funding accounts, then set its company spending limit in Team &
                approvals.
              </Notice>
            )}
            <p className="workspace-description">
              An administrator creates and funds your payment account in Funding
              accounts, then grants its spending limit in Team & approvals. You
              control its assigned balance. Recipient funds stay in the company
              account until payment.
            </p>
            <button
              className="workspace-button"
              disabled={busy || blocked || !feeId}
              onClick={() => void run("quote")}
            >
              {busy ? "Checking…" : "Check my allowance"}
            </button>
            {quote && (
              <>
                <p>
                  Available allowance:{" "}
                  <strong>
                    {formatUnits(BigInt(quote.available), 6)} {payment.token}
                  </strong>
                </p>
                <p className="workspace-description">
                  Your assigned account will authorize every saved recipient
                  together, within its company spending limit. Review the USDC
                  gas fee before signing. This step does not send the payment.
                </p>
                <button
                  className="workspace-button workspace-button-primary"
                  disabled={busy || blocked}
                  onClick={() => void run("authorize")}
                >
                  {busy ? "Preparing…" : "Review fee and approval"}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </details>
  );
}
