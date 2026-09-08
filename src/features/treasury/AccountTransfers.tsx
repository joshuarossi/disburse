import { TREASURY_OPERATOR_ROLES } from "../../../shared/roles";
import { useRef, useState } from "react";
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { useAccount } from "wagmi";
import { ArrowRightLeft, ExternalLink } from "lucide-react";
import { formatUnits } from "viem";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  assertCctpRoute,
  CCTP_SOURCE_CHAINS,
  decodeCctpQuote,
} from "../../../shared/cctp";
import { amountToBaseUnits } from "../../../shared/validation";
import { chainEnvironment } from "../../../shared/assets";
import { useSessionToken } from "@/lib/session";
import { getChainName, getBlockExplorerTxUrl } from "@/lib/chains";
import { userErrorMessage } from "@/lib/userErrors";
import { scheduleDateTime } from "@/lib/formatMoney";
import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { CustomerPaidExecution } from "@/features/payments/CustomerPaidExecution";
import { Dialog } from "@/components/ui/Dialog";
import {
  LoadingRows,
  Notice,
} from "@/components/workspace/WorkspacePrimitives";

const statuses = {
  quoted: "Ready for review",
  approving: "Needs approval",
  processing: "Sending",
  delivering: "On its way",
  completed: "Received",
  cancelled: "Cancelled",
  failed: "Did not start",
  expired: "Quote expired",
};
const units = (raw: string) => `${formatUnits(BigInt(raw), 6)} USDC`;
export function AccountTransfers({
  orgId,
  accounts,
}: {
  orgId: Id<"orgs">;
  accounts: Doc<"safes">[];
}) {
  const sessionToken = useSessionToken(),
    { address } = useAccount(),
    { environment } = useActivityEnvironment();
  const scope = sessionToken ? { orgId, sessionToken } : "skip";
  const {
    results: transfers,
    status: listStatus,
    loadMore,
  } = usePaginatedQuery(
    api.treasury.list,
    sessionToken && environment !== "unclassified"
      ? { orgId, sessionToken, environment }
      : "skip",
    { initialNumItems: 20 },
  );
  const members = useQuery(api.orgs.listMembers, scope);
  const member = members?.find(
    (m) => m?.walletAddress.toLowerCase() === address?.toLowerCase(),
  );
  const canWrite = member && TREASURY_OPERATOR_ROLES.includes(member.role);
  const [show, setShow] = useState(false),
    [selected, setSelected] = useState<Id<"treasuryTransfers">>(),
    [source, setSource] = useState(""),
    [destination, setDestination] = useState(""),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [executing, setExecuting] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState("");
  const lock = useRef(false),
    requestId = useRef(crypto.randomUUID());
  const create = useAction(api.treasuryActions.prepare),
    stop = useMutation(api.treasury.stop),
    recheck = useMutation(api.treasury.queue);
  const saved = useQuery(
    api.treasury.get,
    selected && sessionToken
      ? { treasuryTransferId: selected, sessionToken }
      : "skip",
  );
  const cancellation = useQuery(
    api.circlePayments.get,
    saved?.cancellationRequestedAt && saved.circleExecutionId && sessionToken
      ? { cancelExecutionId: saved.circleExecutionId, sessionToken }
      : "skip",
  );
  const sources = accounts.filter(
    (a) =>
      a.isActive !== false &&
      chainEnvironment(a.chainId) === environment &&
      (CCTP_SOURCE_CHAINS as readonly number[]).includes(a.chainId),
  );
  const sourceAccount = sources.find((a) => a._id === source) ?? sources[0];
  const destinations = accounts.filter((a) => {
    if (!sourceAccount || a.isActive === false) return false;
    try {
      assertCctpRoute(sourceAccount.chainId, a.chainId);
      return true;
    } catch {
      return false;
    }
  });
  const destinationAccount =
    destinations.find((a) => a._id === destination) ?? destinations[0];
  const accountName = (id: string) => {
    const account = accounts.find((a) => a._id === id);
    return (
      account?.name ??
      (account
        ? `${getChainName(account.chainId)} account`
        : "Archived account")
    );
  };
  const memberName = (wallet: string) =>
    members?.find(
      (m) => m?.walletAddress.toLowerCase() === wallet.toLowerCase(),
    )?.name || "Account owner";
  let quote,
    quoteError = "";
  if (saved)
    try {
      quote = decodeCctpQuote(saved.quote);
    } catch {
      quoteError =
        "The saved transfer could not be read. Check the original request before creating another.";
    }
  const run = async (work: () => Promise<unknown>) => {
    if (lock.current || executing) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        userErrorMessage(
          e,
          selected
            ? "This step could not be completed. Your original transfer is saved; try again shortly."
            : "This step could not be completed. Your account choices and amount are unchanged. Try again shortly.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const close = () => {
    if (!busy && !executing) setShow(false);
  };
  const original =
    saved && sessionToken
      ? { treasuryTransferId: saved._id, sessionToken }
      : null;
  return (
    <section
      className="workspace-panel mt-6"
      aria-label="Transfers between accounts"
    >
      <div className="workspace-panel-heading flex flex-wrap gap-4">
        <div>
          <h2>Transfers between accounts</h2>
          <p>
            Move funds between your company's accounts on different networks.
          </p>
        </div>
        {canWrite && (
          <button
            className="workspace-button"
            onClick={() => {
              setSelected(undefined);
              setShow(true);
              setError("");
              setConsent("");
              requestId.current = crypto.randomUUID();
            }}
          >
            <ArrowRightLeft size={14} />
            New transfer
          </button>
        )}
      </div>
      {listStatus === "LoadingFirstPage" && environment !== "unclassified" ? (
        <LoadingRows />
      ) : !transfers.length ? (
        <p className="p-6 text-sm text-[var(--ws-muted)]">
          No account transfers yet. Your account owners review the receiving
          account, amount and fees before funds move.
        </p>
      ) : (
        <div className="divide-y divide-[var(--ws-border)]">
          {transfers.map((transfer) => {
            let label = "Saved transfer";
            try {
              label = units(decodeCctpQuote(transfer.quote).amount);
            } catch {
              /* Recovery remains accessible for an unreadable record. */
            }
            return (
              <button
                key={transfer._id}
                data-transfer-id={transfer._id}
                className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left hover:bg-[var(--ws-hover)]"
                onClick={() => {
                  setSelected(transfer._id);
                  setShow(true);
                  setError("");
                  setConsent("");
                }}
              >
                <span className="min-w-0">
                  <span className="block font-medium">
                    {accountName(transfer.safeId)} →{" "}
                    {accountName(transfer.destinationSafeId)}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--ws-muted)]">
                    {getChainName(transfer.chainId)} →{" "}
                    {getChainName(transfer.destinationChainId)}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block tabular-nums">
                    {transfer.deliveredAmount
                      ? units(transfer.deliveredAmount)
                      : label}
                  </span>
                  <span className="workspace-status mt-1">
                    {statuses[transfer.status]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {(listStatus === "CanLoadMore" || listStatus === "LoadingMore") && (
        <div className="p-5">
          <button
            className="workspace-button"
            disabled={listStatus === "LoadingMore"}
            onClick={() => loadMore(20)}
          >
            {listStatus === "LoadingMore"
              ? "Loading transfers…"
              : "Load older transfers"}
          </button>
        </div>
      )}
      {show && (
        <Dialog
          title={selected ? "Account transfer" : "Transfer between accounts"}
          onClose={close}
        >
          <div className="space-y-5 p-5 sm:p-6">
            {error && <Notice>{error}</Notice>}
            {selected ? (
              saved === undefined ? (
                <LoadingRows />
              ) : !saved ? (
                <Notice>
                  This transfer could not be found. Close this window to return
                  to your accounts.
                </Notice>
              ) : quoteError ? (
                <Notice>{quoteError}</Notice>
              ) : (
                quote && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-medium">
                        {accountName(saved.safeId)} →{" "}
                        {accountName(saved.destinationSafeId)}
                      </p>
                      <span className="workspace-status">
                        {statuses[saved.status]}
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <dt className="text-[var(--ws-muted)]">From</dt>
                      <dd className="text-right">
                        {getChainName(quote.chainId)}
                      </dd>
                      <dt className="text-[var(--ws-muted)]">To</dt>
                      <dd className="text-right">
                        {getChainName(quote.destinationChainId)}
                      </dd>
                      <dt className="text-[var(--ws-muted)]">
                        Minimum received
                      </dt>
                      <dd className="text-right font-semibold tabular-nums">
                        {units(quote.amount)}
                      </dd>
                      <dt className="text-[var(--ws-muted)]">
                        Maximum delivery fee
                      </dt>
                      <dd className="text-right tabular-nums">
                        {units(quote.feeLimit)}
                      </dd>
                      <dt className="text-[var(--ws-muted)]">
                        Transfer and delivery
                      </dt>
                      <dd className="text-right tabular-nums">
                        {units(quote.total)}
                      </dd>
                      <dt className="text-[var(--ws-muted)]">Provider</dt>
                      <dd className="text-right">Circle CCTP</dd>
                      {saved.deliveredAmount && (
                        <>
                          <dt className="text-[var(--ws-muted)]">Received</dt>
                          <dd className="text-right font-semibold tabular-nums">
                            {units(saved.deliveredAmount)}
                          </dd>
                          <dt className="text-[var(--ws-muted)]">
                            Delivery fee charged
                          </dt>
                          <dd className="text-right tabular-nums">
                            {units(saved.deliveryFee!)}
                          </dd>
                        </>
                      )}
                    </dl>
                    <details className="text-xs text-[var(--ws-muted)]">
                      <summary className="cursor-pointer">
                        Review full account addresses
                      </summary>
                      <p className="mt-3">From {accountName(saved.safeId)}</p>
                      <p className="mt-1 break-all font-mono">
                        {quote.account}
                      </p>
                      <p className="mt-3">
                        To {accountName(saved.destinationSafeId)}
                      </p>
                      <p className="mt-1 break-all font-mono">
                        {quote.destination}
                      </p>
                    </details>
                    {!saved.deliveredAmount && (
                      <p className="text-sm text-[var(--ws-muted)]">
                        Circle charges delivery from the transferred USDC and
                        may use the full delivery fee. The receiving account
                        gets at least the amount shown. Your sending account
                        pays execution separately in USDC. Standard delivery
                        waits for the source network to finalize, which can take
                        tens of minutes.
                      </p>
                    )}
                    {saved.error && <Notice>{saved.error}</Notice>}
                    {saved.status === "delivering" && (
                      <>
                        <Notice tone="info">
                          Funds have left the sending account. Delivery to the
                          receiving account is being checked. You can close this
                          window; delivery checks continue automatically.
                        </Notice>
                        {canWrite && sessionToken && (
                          <DeliveryReceiptCheck
                            key={saved._id}
                            id={saved._id}
                            sessionToken={sessionToken}
                            busy={busy || executing}
                            run={run}
                          />
                        )}
                      </>
                    )}
                    {saved.status === "processing" && (
                      <Notice tone="info">
                        The original transfer is being checked. A replacement
                        could send twice. You can close this window while
                        confirmation continues.
                      </Notice>
                    )}
                    {saved.status === "failed" && (
                      <Notice tone="info">
                        The transfer did not start. Review any execution charge
                        below before creating another quote.
                      </Notice>
                    )}
                    {saved.status === "expired" && (
                      <Notice tone="info">
                        This quote expired without a confirmed transfer. Close
                        this window to request a fresh quote.
                      </Notice>
                    )}
                    {saved.status === "cancelled" && (
                      <Notice tone="info">
                        This transfer has been cancelled. Its saved record
                        remains available for your team.
                      </Notice>
                    )}
                    {saved.open && !saved.cancellationRequestedAt && (
                      <>
                        <p className="text-xs text-[var(--ws-muted)]">
                          Quote expires {scheduleDateTime(quote.expiresAt)}.
                        </p>
                        <label className="flex items-start gap-3 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={consent === saved.hash}
                            disabled={busy || executing || !canWrite}
                            onChange={(e) =>
                              setConsent(e.target.checked ? saved.hash : "")
                            }
                          />
                          <span>
                            I have reviewed the receiving account, minimum
                            amount and delivery fee. Once sent, this transfer
                            cannot be cancelled.
                          </span>
                        </label>
                      </>
                    )}
                    {saved.cancellationRequestedAt &&
                    (saved.open || cancellation) &&
                    saved.circleExecutionId ? (
                      <>
                        {saved.open && (
                          <Notice tone="info">
                            A wallet approval may already exist. Cancel its
                            authorization on the network before starting a
                            replacement. The original transfer remains recorded.
                          </Notice>
                        )}
                        <CustomerPaidExecution
                          source={{
                            cancelExecutionId: saved.circleExecutionId,
                          }}
                          ready={saved.open && !!canWrite}
                          blocked={!canWrite || busy}
                          memberName={memberName}
                          onBusyChange={setExecuting}
                          compact
                        />
                      </>
                    ) : (
                      <CustomerPaidExecution
                        source={{ treasuryTransferId: saved._id }}
                        ready={
                          saved.open && consent === saved.hash && !!canWrite
                        }
                        blocked={
                          !canWrite ||
                          busy ||
                          (saved.open && consent !== saved.hash)
                        }
                        principalUSDC={quote.total}
                        memberName={memberName}
                        onBusyChange={setExecuting}
                        compact
                      />
                    )}
                    <div className="flex flex-wrap gap-3">
                      {saved.sourceTxHash && (
                        <a
                          className="workspace-action-link"
                          href={getBlockExplorerTxUrl(
                            quote.chainId,
                            saved.sourceTxHash,
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Sending receipt
                          <ExternalLink size={13} />
                        </a>
                      )}
                      {saved.destinationTxHash && (
                        <a
                          className="workspace-action-link"
                          href={getBlockExplorerTxUrl(
                            quote.destinationChainId,
                            saved.destinationTxHash,
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Receiving receipt
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {canWrite &&
                        ["processing", "delivering", "approving"].includes(
                          saved.status,
                        ) && (
                          <button
                            className="workspace-button"
                            disabled={busy || executing}
                            onClick={() => void run(() => recheck(original!))}
                          >
                            Check transfer status
                          </button>
                        )}
                      {canWrite &&
                        saved.open &&
                        !saved.cancellationRequestedAt &&
                        ["quoted", "approving"].includes(saved.status) && (
                          <button
                            className="workspace-button"
                            disabled={busy || executing}
                            onClick={() => void run(() => stop(original!))}
                          >
                            Stop transfer
                          </button>
                        )}
                    </div>
                  </>
                )
              )
            ) : (
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!sourceAccount || !destinationAccount || !sessionToken)
                    return;
                  void run(async () => {
                    const id = await create({
                      orgId,
                      safeId: sourceAccount._id,
                      destinationSafeId: destinationAccount._id,
                      amount: String(amountToBaseUnits(amount, "USDC")),
                      requestId: requestId.current,
                      sessionToken,
                    });
                    setSelected(id);
                  });
                }}
              >
                <p className="workspace-description">
                  Choose the company account to fund. The receiving account can
                  use the transferred balance for its own payments.
                </p>
                {!sources.length || !destinations.length ? (
                  <Notice tone="info">
                    Connect accounts on two supported networks to transfer
                    between them. Business transfers support Base and Arbitrum.
                    Test transfers support Base Sepolia to Sepolia.
                  </Notice>
                ) : (
                  <>
                    <label className="block">
                      <span className="finance-label">From account</span>
                      <select
                        className="finance-field"
                        value={sourceAccount?._id ?? ""}
                        disabled={busy}
                        onChange={(e) => {
                          setSource(e.target.value);
                          setDestination("");
                        }}
                      >
                        {sources.map((a) => (
                          <option key={a._id} value={a._id}>
                            {accountName(a._id)} · {getChainName(a.chainId)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="finance-label">Receiving account</span>
                      <select
                        className="finance-field"
                        value={destinationAccount?._id ?? ""}
                        disabled={busy}
                        onChange={(e) => setDestination(e.target.value)}
                      >
                        {destinations.map((a) => (
                          <option key={a._id} value={a._id}>
                            {accountName(a._id)} · {getChainName(a.chainId)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="finance-label">
                        Amount to receive, USDC
                      </span>
                      <input
                        className="finance-field"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={amount}
                        required
                        disabled={busy}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </label>
                    <p className="text-xs text-[var(--ws-muted)]">
                      You will review the provider's delivery fee and your
                      account's execution fee before approving. Recipient
                      payment instructions stay unchanged.
                    </p>
                    <button
                      className="workspace-button workspace-button-primary"
                      disabled={busy || !canWrite}
                    >
                      {busy ? "Getting quote…" : "Review transfer"}
                    </button>
                  </>
                )}
              </form>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}

function DeliveryReceiptCheck({
  id,
  sessionToken,
  busy,
  run,
}: {
  id: Id<"treasuryTransfers">;
  sessionToken: string;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const report = useMutation(api.treasury.reportDelivery);
  const [hash, setHash] = useState(""),
    [submitted, setSubmitted] = useState(false);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-[var(--ws-muted)]">
        Already have a receiving receipt?
      </summary>
      <p className="mt-3 text-[var(--ws-muted)]">
        If another service completed delivery, add its transaction hash. We
        verify the receiving account, amount and original transfer before
        marking it received.
      </p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (!/^0x[\da-f]{64}$/i.test(hash.trim()))
              throw new Error(
                "Enter the full receiving transaction hash, starting with 0x.",
              );
            await report({
              treasuryTransferId: id,
              sessionToken,
              txHash: hash.trim(),
            });
            setSubmitted(true);
          });
        }}
      >
        <label className="block">
          <span className="finance-label">Receiving transaction hash</span>
          <input
            className="finance-field font-mono text-xs"
            value={hash}
            autoComplete="off"
            spellCheck={false}
            maxLength={66}
            disabled={busy}
            onChange={(e) => {
              setHash(e.target.value);
              setSubmitted(false);
            }}
          />
        </label>
        <button
          className="workspace-button"
          disabled={busy || !hash.trim()}
          type="submit"
        >
          {busy ? "Checking receipt…" : "Verify receiving receipt"}
        </button>
        {submitted && (
          <p role="status" className="text-sm text-[var(--ws-muted)]">
            Receipt saved for verification. The transfer remains on its way
            until its delivery is confirmed.
          </p>
        )}
      </form>
    </details>
  );
}
