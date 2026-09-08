import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAccount, useSwitchChain } from "wagmi";
import type { Address, Hex } from "viem";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { AccountApprovalView } from "../../../shared/accountApprovalView";
import { USDC_WALLET_CHAINS } from "../../../shared/walletCalls";
import { useSessionToken } from "@/lib/session";
import { signAccountApproval } from "@/lib/accountApproval";
import {
  saveWalletSetupAttempt,
  readWalletSetupAttempt,
  clearWalletSetupAttempt,
} from "@/lib/services/walletSetupJournal";
import { walletDeclined, walletErrorMessage } from "@/lib/walletErrors";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/workspace/WorkspacePrimitives";

export function AccountFeeSetup({
  account,
  isAdmin,
  canApprove,
}: {
  account: Doc<"safes">;
  isAdmin: boolean;
  canApprove: boolean;
}) {
  const sessionToken = useSessionToken(),
    { address, chainId } = useAccount(),
    { switchChainAsync } = useSwitchChain();
  const identity = { safeId: account._id, sessionToken: sessionToken ?? "" };
  const saved = useQuery(
    api.accountFeeSetups.current,
    sessionToken ? identity : "skip",
  );
  const inspect = useAction(api.accountFeeSetups.inspect),
    prepare = useAction(api.accountFeeSetups.prepare),
    loadApprovals = useAction(api.accountFeeSetups.approvals),
    approve = useAction(api.accountFeeSetups.approve),
    begin = useAction(api.accountFeeSetups.begin),
    check = useAction(api.accountFeeSetups.check),
    declined = useMutation(api.accountFeeSetups.declined),
    discard = useMutation(api.accountFeeSetups.discard);
  const [expanded, setExpanded] = useState(false),
    [ready, setReady] = useState<boolean>(),
    [review, setReview] = useState<AccountApprovalView>(),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [receipt, setReceipt] = useState(""),
    [notice, setNotice] = useState<{ tone: "info" | "error"; text: string }>();
  const lock = useRef(false),
    requestId = useRef(crypto.randomUUID());
  const setup = saved?.open ? saved : undefined;
  const attempt = setup ? readWalletSetupAttempt(setup._id) : null;
  const restorable =
    setup?.stage === "requested" &&
    !!attempt &&
    attempt.claimId === setup.claimId &&
    attempt.batchId === setup.batchId &&
    attempt.phase !== "wallet";
  const supported = (USDC_WALLET_CHAINS as readonly number[]).includes(
    account.chainId,
  );
  useEffect(() => {
    setReview(undefined);
    setConsent(false);
  }, [setup?._id, setup?.updatedAt, address]);
  async function run(work: () => Promise<void>) {
    if (lock.current || !sessionToken) return;
    lock.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      await work();
    } catch (e) {
      setNotice({
        tone: walletDeclined(e) ? "info" : "error",
        text: walletErrorMessage(
          e,
          "Could not complete account fee setup. Your original request is saved. Check it before trying again.",
        ),
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function connect() {
    if (!address) throw new Error("Connect your approver wallet.");
    if (chainId !== account.chainId)
      await switchChainAsync({ chainId: account.chainId });
  }
  const args =
    setup && sessionToken ? { setupId: setup._id, sessionToken } : undefined;
  async function send() {
    if (!args || !setup || !consent || !review?.ready) return;
    await connect();
    const wallet = await import("@/lib/services/metamaskCalls");
    const provider = await wallet.checkCustomerWallet({
      chainId: account.chainId,
      payer: address as Address,
    });
    const claimId = crypto.randomUUID();
    saveWalletSetupAttempt(setup._id, {
      claimId,
      batchId: setup.batchId,
      phase: "claiming",
    });
    const request = await begin({ ...args, claimId });
    saveWalletSetupAttempt(setup._id, {
      claimId,
      batchId: request.batchId,
      phase: "wallet",
    });
    try {
      await wallet.submitCustomerWalletCalls(
        request.intent,
        request.batchId as Hex,
        provider,
      );
    } catch (e) {
      if (walletDeclined(e) || wallet.walletRequestNotAccepted(e)) {
        saveWalletSetupAttempt(setup._id, {
          claimId,
          batchId: request.batchId,
          phase: "declined",
        });
        await declined({ ...args, claimId, batchId: request.batchId });
        clearWalletSetupAttempt(setup._id);
        setConsent(false);
        setNotice({
          tone: walletDeclined(e) ? "info" : "error",
          text: walletDeclined(e)
            ? "Wallet confirmation cancelled. The account approvals are saved."
            : "MetaMask did not accept this request. Check your wallet settings, then review the saved account approvals.",
        });
        return;
      }
      throw new Error(
        "The wallet response was interrupted. Check the saved request before trying another submission.",
      );
    }
    setNotice({
      tone: "info",
      text: "Setup submitted. We are checking the original receipt.",
    });
  }
  async function recover() {
    if (!args || !setup) return;
    if (receipt.trim()) await check({ ...args, txHash: receipt.trim() });
    else {
      // Chain recovery remains available when this browser cannot reach the
      // original wallet or its local batch history has been cleared.
      await check(args);
      if (
        setup.stage === "requested" &&
        address?.toLowerCase() === setup.payer?.toLowerCase()
      ) {
        await connect();
        const wallet = await import("@/lib/services/metamaskCalls");
        const result = await wallet.checkCustomerWalletCalls(
          account.chainId,
          setup.batchId as Hex,
        );
        if (result.txHash) await check({ ...args, txHash: result.txHash });
      }
    }
    setNotice({
      tone: "info",
      text: "Checking the original setup receipt. This does not submit another transaction.",
    });
  }
  if (!canApprove) return null;
  return (
    <section
      className="mt-3 border-t border-white/10 pt-3 min-w-0"
      aria-label={`Execution fees for ${account.name ?? "company account"}`}
    >
      <button
        type="button"
        className="text-sm text-accent-400 hover:underline"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        Execution fee setup
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          <p className="workspace-description">
            Use the company account’s USDC to cover payment fees. Existing
            accounts may need a one-time setup approved by their owners.
          </p>
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          {saved === undefined ? (
            <p role="status">Loading saved fee setup…</p>
          ) : !supported ? (
            <Notice tone="info">
              Account fee setup is available on Base and Arbitrum.
            </Notice>
          ) : setup && args ? (
            <>
              <p className="text-sm">
                The account owners approve this setup. The member completing it
                pays its one-time fee from their connected wallet.
              </p>
              {setup.error && <Notice tone="error">{setup.error}</Notice>}
              {setup.stage === "approval" && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setReview(await loadApprovals(args));
                      })
                    }
                  >
                    Review account approvals
                  </Button>
                  {review && (
                    <>
                      {review.blockedReason && (
                        <Notice tone="info">{review.blockedReason}</Notice>
                      )}
                      <p className="text-sm">
                        {review.groups.find(
                          (g) =>
                            g.address === account.safeAddress.toLowerCase(),
                        )?.confirmedOwners.length ?? 0}{" "}
                        of{" "}
                        {review.groups.find(
                          (g) =>
                            g.address === account.safeAddress.toLowerCase(),
                        )?.threshold ?? account.threshold}{" "}
                        owner approvals collected.
                      </p>
                      {review.paths
                        .filter((path) => !path.approved)
                        .map((path) => (
                          <Button
                            key={path.path.join(":")}
                            size="sm"
                            variant="secondary"
                            disabled={busy || !!review.blockedReason}
                            onClick={() =>
                              void run(async () => {
                                await connect();
                                const signature = await signAccountApproval(
                                  account.chainId,
                                  address!,
                                  review.proposal,
                                  path.path,
                                );
                                await approve({
                                  ...args,
                                  path: path.path,
                                  signature,
                                });
                                setReview(await loadApprovals(args));
                                setNotice({
                                  tone: "info",
                                  text: "Your account setup approval is saved.",
                                });
                              })
                            }
                          >
                            {review.paths.length > 1
                              ? `Approve through ${path.labels.join(" → ")}`
                              : "Approve fee setup"}
                          </Button>
                        ))}
                      {review.ready && (
                        <>
                          <p className="workspace-description">
                            MetaMask shows the complete setup fee before
                            confirmation. Choose USDC in its Network fee field.
                            If USDC is unavailable, cancel and check your wallet
                            balance and Smart Transactions settings.
                          </p>
                          <label className="flex gap-2 items-start text-sm">
                            <input
                              type="checkbox"
                              checked={consent}
                              onChange={(e) => setConsent(e.target.checked)}
                            />
                            <span>
                              I will review and pay this setup fee in USDC from
                              my connected wallet.
                            </span>
                          </label>
                          <Button
                            size="sm"
                            disabled={busy || !consent}
                            onClick={() => void run(send)}
                          >
                            Complete setup in MetaMask
                          </Button>
                        </>
                      )}
                    </>
                  )}
                  {isAdmin && !setup.signatures.length && !setup.attempt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await discard(args);
                          requestId.current = crypto.randomUUID();
                        })
                      }
                    >
                      Discard unsigned setup
                    </Button>
                  )}
                </>
              )}
              {setup.stage === "requested" && (
                <>
                  <Notice tone="info">
                    The original wallet request is saved. Check its receipt
                    before starting another paid attempt.
                  </Notice>
                  {restorable && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await declined({
                            ...args,
                            claimId: attempt!.claimId,
                            batchId: attempt!.batchId,
                          });
                          clearWalletSetupAttempt(setup._id);
                          setNotice({
                            tone: "info",
                            text: "The unsubmitted wallet step was restored. Your account approvals are saved.",
                          });
                        })
                      }
                    >
                      Restore unsubmitted wallet step
                    </Button>
                  )}
                </>
              )}
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void run(recover)}
              >
                Check setup receipt
              </Button>
              <details>
                <summary className="text-xs cursor-pointer">
                  Link an existing receipt
                </summary>
                <label className="block mt-2">
                  <span className="finance-label">
                    Setup transaction receipt
                  </span>
                  <input
                    className="finance-field font-mono text-xs"
                    value={receipt}
                    onChange={(e) => setReceipt(e.target.value)}
                    placeholder="0x transaction hash"
                  />
                </label>
              </details>
            </>
          ) : (
            <>
              {saved?.stage === "complete" && (
                <Notice tone="info">
                  Account fee setup completed. Check the current configuration
                  below.
                </Notice>
              )}
              {saved?.error && <Notice tone="error">{saved.error}</Notice>}
              {ready === true ? (
                <p role="status" className="text-sm text-green-400">
                  This account is ready to pay execution fees in USDC.
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setReady((await inspect(identity)).ready);
                    })
                  }
                >
                  Check fee support
                </Button>
              )}
              {ready === false && isAdmin && (
                <>
                  <p className="workspace-description">
                    Enable the published Safe fee module and signature handler.
                    It uses the account’s current owner approvals and gives
                    Disburse no signing authority.
                  </p>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await prepare({
                          ...identity,
                          requestId: requestId.current,
                        });
                      })
                    }
                  >
                    Prepare USDC fee setup
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
