import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAccount, useSwitchChain } from "wagmi";
import { formatUnits, parseUnits, type Hex } from "viem";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { walletDeclined, walletErrorMessage } from "@/lib/walletErrors";
import {
  WALLET_SETUP_CHAINS,
  type WalletSetupIntent,
} from "../../../shared/walletSetup";
import {
  saveWalletSetupAttempt,
  readWalletSetupAttempt,
  clearWalletSetupAttempt,
} from "@/lib/services/walletSetupJournal";

export type SetupProps = {
  orgId: Id<"orgs">;
  owners: string[];
  threshold: number;
  chainId: number;
  onBusy: (busy: boolean) => void;
  onComplete: () => void;
  onRestore: (settings: {
    chainId: number;
    owners: string[];
    threshold: number;
  }) => void;
};
export function MetaMaskPaidSetup({
  orgId,
  owners,
  threshold,
  chainId,
  onBusy,
  onComplete,
  onRestore,
}: SetupProps) {
  const sessionToken = useSessionToken(),
    { address, chain } = useAccount(),
    { switchChainAsync } = useSwitchChain();
  const current = useQuery(
    api.walletSetups.current,
    sessionToken ? { orgId, sessionToken } : "skip",
  );
  const [setupId, setSetupId] = useState<Id<"walletSetups">>();
  const saved = useQuery(
      api.walletSetups.get,
      setupId && sessionToken ? { setupId, sessionToken } : "skip",
    ),
    setup = setupId ? saved : current;
  const prepare = useAction(api.walletSetups.prepare),
    begin = useMutation(api.walletSetups.begin),
    declined = useMutation(api.walletSetups.declined),
    complete = useAction(api.walletSetups.complete),
    discard = useMutation(api.walletSetups.discard);
  const validate = useAction(api.walletSetups.validate);
  const [deposit, setDeposit] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [notice, setNotice] = useState<{
      message: string;
      tone: "info" | "error";
    }>();
  const lock = useRef(false),
    requestId = useRef(crypto.randomUUID()),
    restored = useRef<string | undefined>(undefined);
  const supported = (WALLET_SETUP_CHAINS as readonly number[]).includes(
    chainId,
  );
  const attempt = setup ? readWalletSetupAttempt(setup._id) : null;
  const restorable =
    setup?.stage === "requested" &&
    !!attempt &&
    attempt.claimId === setup.claimId &&
    attempt.batchId === setup.batchId &&
    attempt.phase !== "wallet";
  useEffect(() => {
    onBusy(busy || !!setup?.open);
  }, [busy, setup?.open, onBusy]);
  useEffect(() => {
    if (setup && restored.current !== setup._id) {
      restored.current = setup._id;
      onRestore({
        chainId: setup.chainId,
        owners: setup.owners,
        threshold: setup.threshold,
      });
      setDeposit(formatUnits(BigInt(setup.deposit), 6));
    }
  }, [setup, onRestore]);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      await work();
    } catch (e) {
      setNotice({
        tone: walletDeclined(e) ? "info" : "error",
        message: walletErrorMessage(
          e,
          "Could not complete account setup. Your original details are saved. Check the request before trying again.",
        ),
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  async function submit() {
    if (!setup || !sessionToken || setup.stage !== "prepared" || !consent)
      return;
    const wallet = await import("@/lib/services/metamaskSetup");
    const intent = setup as WalletSetupIntent;
    if (chain?.id !== setup.chainId)
      await switchChainAsync({ chainId: setup.chainId });
    const provider = await wallet.checkSetupWallet(intent);
    await validate({ setupId: setup._id, sessionToken });
    // Save the exact wallet batch ID before any request that can submit work.
    const claimId = crypto.randomUUID();
    saveWalletSetupAttempt(setup._id, {
      claimId,
      batchId: setup.batchId,
      phase: "claiming",
    });
    let batchId: string;
    try {
      batchId = await begin({ setupId: setup._id, sessionToken, claimId });
    } catch {
      throw new Error(
        "Could not save the setup request. No wallet confirmation was opened here. Check the saved request before trying again.",
      );
    }
    saveWalletSetupAttempt(setup._id, { claimId, batchId, phase: "wallet" });
    try {
      await wallet.submitWalletSetup(intent, batchId as Hex, provider);
    } catch (e) {
      if (walletDeclined(e) || wallet.walletSetupNotAccepted(e)) {
        saveWalletSetupAttempt(setup._id, {
          claimId,
          batchId,
          phase: "declined",
        });
        await declined({
          setupId: setup._id,
          sessionToken,
          batchId,
          claimId,
          reason: "declined",
        });
        clearWalletSetupAttempt(setup._id);
        const cancelled =
          walletDeclined(e) || (e as { code?: number })?.code === 5750;
        setConsent(false);
        setNotice({
          tone: cancelled ? "info" : "error",
          message: cancelled
            ? "Wallet confirmation cancelled. Your account settings and deposit amount are saved."
            : "MetaMask did not accept this setup request. Your details are saved. Check your wallet connection and settings before trying again.",
        });
        return;
      }
      setNotice({
        tone: "error",
        message:
          "MetaMask did not confirm the submission. Your original setup request is saved. Check its status before trying again.",
      });
      return;
    }
    setNotice({
      tone: "info",
      message:
        "Setup submitted. Check the receipt to connect your company account.",
    });
  }
  async function check() {
    if (!setup || !sessionToken) return;
    if (setup.stage === "complete") {
      onComplete();
      return;
    }
    if (chain?.id !== setup.chainId)
      await switchChainAsync({ chainId: setup.chainId });
    const wallet = await import("@/lib/services/metamaskSetup");
    const result = await wallet.checkWalletSetup(
      setup as WalletSetupIntent,
      setup.batchId as Hex,
    );
    if (result.txHash) {
      const status = await complete({
        setupId: setup._id,
        sessionToken,
        txHash: result.txHash,
      });
      clearWalletSetupAttempt(setup._id);
      if (status === "complete") {
        onComplete();
        return;
      }
      setConsent(false);
      setNotice({
        tone: "error",
        message:
          "The account setup transaction reverted. Your deposit was not transferred. Check MetaMask for any execution fee before approving another attempt.",
      });
      return;
    }
    setNotice({
      tone: "info",
      message:
        result.status < 400
          ? "MetaMask is still processing the original request. Checking again does not submit another transaction."
          : "MetaMask did not provide a confirmed receipt. Review this request in your wallet and keep it for recovery.",
    });
  }
  return (
    <section className="space-y-4" aria-label="Account setup cost">
      {notice && <Notice tone={notice.tone}>{notice.message}</Notice>}
      {current === undefined || (setupId && saved === undefined) ? (
        <p role="status" className="workspace-description">
          Loading saved account setup…
        </p>
      ) : setup ? (
        <>
          <div
            className="rounded-lg border border-slate-400/20 p-4 space-y-3"
            aria-label="Setup review"
          >
            <div className="flex justify-between gap-4">
              <span>Company account deposit</span>
              <strong>{formatUnits(BigInt(setup.deposit), 6)} USDC</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span>Setup fee</span>
              <strong>Review in MetaMask</strong>
            </div>
            <p className="workspace-description">
              {setup.threshold} of {setup.owners.length} account owners must
              approve future payments. Your account uses its own USDC for
              payment fees.
            </p>
          </div>
          {setup.stage === "prepared" ? (
            <>
              {address?.toLowerCase() !== setup.payer.toLowerCase() && (
                <Notice tone="info">
                  Reconnect the wallet that prepared this account to continue:{" "}
                  <span className="break-all">{setup.payer}</span>.
                </Notice>
              )}
              <p className="workspace-description">
                MetaMask shows the final setup fee before you approve. Choose
                USDC in its Network fee field. Your wallet pays MetaMask
                directly. If USDC is unavailable, cancel the confirmation and
                enable Smart Transactions and Estimate balance changes in
                MetaMask settings.
              </p>
              <label className="flex gap-3 items-start text-sm">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  I will review and pay the setup fee in USDC in MetaMask. A
                  failed transaction may still incur a fee.
                </span>
              </label>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await discard({
                        setupId: setup._id,
                        sessionToken: sessionToken!,
                      });
                      setSetupId(undefined);
                      requestId.current = crypto.randomUUID();
                      setConsent(false);
                    })
                  }
                >
                  Edit setup
                </Button>
                <Button
                  disabled={
                    busy ||
                    !consent ||
                    address?.toLowerCase() !== setup.payer.toLowerCase()
                  }
                  onClick={() => void run(submit)}
                >
                  {busy ? "Confirm in MetaMask…" : "Confirm setup in MetaMask"}
                </Button>
              </div>
            </>
          ) : restorable ? (
            <>
              <Notice tone="info">
                This browser saved the request before sending it, or recorded
                that the wallet declined it. Restore the saved setup to
                continue.
              </Notice>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await declined({
                      setupId: setup._id,
                      sessionToken: sessionToken!,
                      batchId: attempt!.batchId,
                      claimId: attempt!.claimId,
                      reason:
                        attempt!.phase === "declined" ? "declined" : "not_sent",
                    });
                    clearWalletSetupAttempt(setup._id);
                    setConsent(false);
                    setNotice({
                      tone: "info",
                      message:
                        "Your saved account setup is ready to review. No new wallet request was submitted.",
                    });
                  })
                }
              >
                Restore saved setup
              </Button>
            </>
          ) : (
            <Button disabled={busy} onClick={() => void run(check)}>
              {busy
                ? "Checking setup…"
                : setup.stage === "complete"
                  ? "Open company account"
                  : "Check setup status"}
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="workspace-description">
            Create and fund your company account in one MetaMask confirmation.
            Keep USDC in your wallet for the deposit and setup fee.
          </p>
          <label className="block">
            <span className="finance-label">
              Deposit into company account (USDC)
            </span>
            <input
              className="finance-field"
              inputMode="decimal"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              disabled={busy}
              placeholder="100.00"
            />
          </label>
          <p className="text-sm text-slate-400">
            Enter 0 to create an empty account. You still need USDC for its
            setup fee.
          </p>
          {!supported && (
            <Notice tone="info">
              Choose Base or Arbitrum for account setup with USDC fees.
              MetaMask's fee service is not available on testnets.
            </Notice>
          )}
          <Button
            className="w-full"
            disabled={busy || !supported || !deposit.trim() || !sessionToken}
            onClick={() =>
              void run(async () => {
                if (!/^\d+(?:\.\d{1,6})?$/.test(deposit.trim()))
                  throw new Error(
                    "Enter a deposit amount with no more than six decimal places.",
                  );
                const id = await prepare({
                  orgId,
                  sessionToken: sessionToken!,
                  chainId,
                  owners,
                  threshold,
                  deposit: String(parseUnits(deposit.trim(), 6)),
                  requestId: requestId.current,
                });
                setSetupId(id);
              })
            }
          >
            {busy ? "Preparing account…" : "Review setup"}
          </Button>
        </>
      )}
    </section>
  );
}
