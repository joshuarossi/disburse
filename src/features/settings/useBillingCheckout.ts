import { userErrorMessage } from '@/lib/userErrors';
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getSessionToken } from "@/lib/session";
import { useSendTransaction, useSwitchChain } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { config } from "@/lib/wagmi";
import { formatUnits, parseUnits } from "viem";
import { PLANS, type PlanKey } from "@/lib/billingPlans";
import {
  readPendingBilling,
  writePendingBilling,
  withBillingLock,
  type PendingBilling,
} from "./pendingBilling";
import { walletDeclined, walletErrorMessage } from "@/lib/walletErrors";
import { hasPaidTerm, PLAN_LIMITS } from "../../../shared/billing";
export function useBillingCheckout({
  orgId,
  address,
  isAdmin,
  billing,
}: {
  orgId?: string;
  address?: `0x${string}`;
  isAdmin: boolean;
  billing: FunctionReturnType<typeof api.billing.get> | undefined;
}) {
  // Billing state
  const [hasPendingBilling, setHasPendingBilling] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>("team");
  const selectedToken = "USDC";
  const [manualTxHash, setManualTxHash] = useState("");
  const [paymentStep, setPaymentStep] = useState<
    "select" | "pay" | "confirm" | "success"
  >("select");
  const [billingError, setBillingError] = useState<string | null>(null);

  const { sendTransactionAsync, isPending: isSending } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const [txHash, setTxHash] = useState<string>();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const paymentLock = useRef(false);
  const verificationLock = useRef(false);
  const verifySubscriptionPayment = useAction(
    api.billing.verifySubscriptionPayment,
  );
  const subscribe = useMutation(api.billing.subscribe);
  const [checkoutId, setCheckoutId] = useState<Id<"billingCheckouts">>();
  const scope =
    orgId && isAdmin && getSessionToken()
      ? { orgId: orgId as Id<"orgs">, sessionToken: getSessionToken()! }
      : null;
  const currentCheckout = useQuery(
    api.billingCheckoutData.current,
    scope ?? "skip",
  );
  const savedCheckout = useQuery(
    api.billingCheckoutData.get,
    scope && checkoutId ? { ...scope, checkoutId } : "skip",
  );
  const checkout = checkoutId
    ? (savedCheckout ??
      (currentCheckout?._id === checkoutId ? currentCheckout : undefined))
    : currentCheckout;
  const createCheckout = useMutation(api.billingCheckoutData.create);
  const beginCheckout = useAction(api.billingCheckoutActions.begin);
  const walletResult = useMutation(api.billingCheckoutData.walletResult);
  const verifyCheckout = useAction(api.billingCheckoutActions.verify);
  const verifyReplacement = useAction(
    api.billingCheckoutActions.verifyReplacement,
  );
  const discardPrepared = useMutation(api.billingCheckoutData.discard);
  const paymentConfig = checkout
    ? {
        chainId: checkout.chainId as 1 | 11155111,
        treasury: checkout.treasury,
        tokenAddress: checkout.tokenAddress,
        decimals: 6,
        symbol: "USDC" as const,
        testnet: checkout.chainId === 11155111,
        network: checkout.chainId === 11155111 ? "Sepolia" : "Ethereum",
        explorer:
          checkout.chainId === 11155111
            ? "https://sepolia.etherscan.io"
            : "https://etherscan.io",
      }
    : billing?.paymentConfig;
  const checkoutPrice = checkout
    ? formatUnits(BigInt(checkout.amountRaw), 6)
    : String(PLANS[selectedPlan].price);
  const canSendCheckout =
    !checkout ||
    (checkout.status === "prepared" &&
      checkout.payer.toLowerCase() === address?.toLowerCase());
  useEffect(() => {
    if (!checkout || checkout.active || checkoutId !== checkout._id) return;
    if (currentCheckout && currentCheckout._id !== checkout._id) return;
    try {
      writePendingBilling(orgId, null);
    } catch (error) {
      setBillingError(
        userErrorMessage(error, "Could not clear billing recovery."),
      );
      return;
    }
    setHasPendingBilling(false);
    if (checkout.status === "applied") {
      setTxHash(checkout.txHash);
      setPaymentStep("success");
      setBillingError(null);
    } else {
      setCheckoutId(undefined);
      setTxHash(undefined);
      setManualTxHash("");
      setPaymentStep("select");
      setBillingError(
        checkout.status === "reverted"
          ? "The original transaction reverted. No subscription payment was collected."
          : checkout.status === "cancelled"
            ? "The earlier checkout was cancelled. You can review a new payment."
            : "Wallet approval declined. No subscription payment was submitted.",
      );
    }
  }, [checkout, checkoutId, currentCheckout, orgId]);

  // Billing handlers
  const restorePending = (pending: PendingBilling) => {
    setHasPendingBilling(true);
    setCheckoutId(pending.checkoutId as Id<"billingCheckouts"> | undefined);
    setTxHash(pending.hash);
    setSelectedPlan(pending.plan);
    setManualTxHash(pending.hash ?? "");
    setPaymentStep("confirm");
    setBillingError(
      pending.hash
        ? "An earlier subscription payment needs verification. Verify this receipt before sending another payment."
        : "An earlier wallet request has no receipt yet. Check your wallet activity and verify that payment before sending another one.",
    );
    setShowPaymentModal(true);
  };
  const handleOpenPayment = (plan: PlanKey) => {
    if (paymentLock.current || verificationLock.current) return;
    setShowPaymentModal(true);
    try {
      if (currentCheckout) {
        setCheckoutId(currentCheckout._id);
        setSelectedPlan(currentCheckout.plan);
        setHasPendingBilling(currentCheckout.status !== "prepared");
        setTxHash(currentCheckout.txHash);
        setManualTxHash(currentCheckout.txHash ?? "");
        setPaymentStep(
          currentCheckout.status === "prepared" ? "select" : "confirm",
        );
        setBillingError(
          currentCheckout.error ??
            (currentCheckout.status === "prepared"
              ? null
              : "The original subscription request is being checked. Do not send another payment."),
        );
        return;
      }
      const pending = readPendingBilling(orgId);
      if (pending) {
        restorePending(pending);
        return;
      }
      setHasPendingBilling(false);
      setCheckoutId(undefined);
      setTxHash(undefined);
      setSelectedPlan(plan);
      setPaymentStep("select");
      setBillingError(null);
      setManualTxHash("");
    } catch (error) {
      setHasPendingBilling(true);
      setPaymentStep("confirm");
      setBillingError(
        userErrorMessage(error, "Could not read billing recovery."),
      );
    }
  };

  const handleClosePayment = () => {
    if (verificationLock.current || (paymentLock.current && !txHash)) return;
    setShowPaymentModal(false);
    setPaymentStep("select");
    setBillingError(null);
    setManualTxHash("");
  };

  const handlePayWithWallet = async () => {
    if (
      !orgId ||
      !address ||
      !isAdmin ||
      paymentLock.current ||
      txHash ||
      hasPendingBilling ||
      !canSendCheckout
    )
      return;
    if (!paymentConfig) {
      setBillingError(
        "Subscription payments are not configured. No payment was sent.",
      );
      return;
    }
    paymentLock.current = true;
    let submitted: string | undefined;
    let requested = false;
    let sendStarted = false;
    let serverId: Id<"billingCheckouts"> | undefined;
    let serverAttempt: string | undefined;
    setBillingError(null);
    setPaymentStep("pay");
    try {
      await withBillingLock(orgId, async () => {
        const pending = readPendingBilling(orgId);
        if (
          pending &&
          !(
            checkout?.status === "prepared" &&
            pending.checkoutId === checkout._id
          )
        ) {
          restorePending(pending);
          return;
        }
        await switchChainAsync({ chainId: paymentConfig.chainId });
        serverId = await createCheckout({
          orgId: orgId as Id<"orgs">,
          sessionToken: getSessionToken() ?? "",
          requestId: crypto.randomUUID(),
          plan: selectedPlan,
          chainId: paymentConfig.chainId,
          treasury: paymentConfig.treasury,
          tokenAddress: paymentConfig.tokenAddress,
          amountRaw: parseUnits(checkoutPrice, 6).toString(),
        });
        setCheckoutId(serverId);
        const attempt: PendingBilling = {
          plan: selectedPlan,
          checkoutId: serverId,
          attemptId: "preparing",
          startedAt: Date.now(),
          payer: address,
          chainId: paymentConfig.chainId,
        };
        writePendingBilling(orgId, attempt);
        const prepared = await beginCheckout({
          checkoutId: serverId,
          sessionToken: getSessionToken() ?? "",
        });
        serverAttempt = prepared.attemptId;
        requested = true;
        setHasPendingBilling(true);
        sendStarted = true;
        const hash = await sendTransactionAsync({
          account: prepared.payer as `0x${string}`,
          to: prepared.to as `0x${string}`,
          data: prepared.data as `0x${string}`,
          value: 0n,
          nonce: prepared.nonce,
          chainId: prepared.chainId,
        });
        submitted = hash;
        setTxHash(hash);
        setManualTxHash(hash);
        writePendingBilling(orgId, { ...attempt, hash });
        await walletResult({
          checkoutId: serverId,
          sessionToken: getSessionToken() ?? "",
          attemptId: prepared.attemptId,
          txHash: hash,
        });
        setIsConfirming(true);
        const client = getPublicClient(config, {
          chainId: paymentConfig.chainId,
        });
        if (!client)
          throw new Error("Could not connect to the billing network");
        const receipt = await client.waitForTransactionReceipt({
          hash,
          confirmations: 2,
        });
        const result = await verifyCheckout({
          checkoutId: serverId,
          sessionToken: getSessionToken() ?? "",
          txHash: hash,
        });
        if (result.status === "applied" || result.status === "reverted") {
          writePendingBilling(orgId, null);
          requested = false;
          setHasPendingBilling(false);
          if (result.status === "applied") setPaymentStep("success");
          else {
            setTxHash(undefined);
            setManualTxHash("");
            setPaymentStep("select");
            setBillingError(
              "The original transaction reverted. No subscription payment was collected.",
            );
          }
        } else if (receipt.status !== "success")
          throw new Error("The original receipt needs verification.");
      });
    } catch (caught) {
      let error = caught;
      if (requested && !submitted && (!sendStarted || walletDeclined(error))) {
        try {
          await walletResult({
            checkoutId: serverId!,
            sessionToken: getSessionToken() ?? "",
            attemptId: serverAttempt!,
            declined: true,
          });
          writePendingBilling(orgId, null);
          requested = false;
          setCheckoutId(undefined);
          setHasPendingBilling(false);
        } catch (storageError) {
          error = storageError;
        }
      }
      setBillingError(
        submitted
          ? `Payment ${submitted} was submitted. Verify its receipt before sending another payment.`
          : requested
            ? "The wallet response was interrupted. The original request is saved. Check your wallet activity and verify its receipt before sending another payment."
            : walletDeclined(error)
              ? "Wallet approval declined. No subscription payment was submitted."
              : walletErrorMessage(error, "Could not start checkout. Check your wallet connection and try again."),
      );
      setPaymentStep(requested || submitted ? "confirm" : "select");
    } finally {
      paymentLock.current = false;
      setIsConfirming(false);
    }
  };

  const handleConfirmPayment = async (hash: string) => {
    if (!orgId || !address || !isAdmin || !hash || verificationLock.current)
      return;
    verificationLock.current = true;
    setIsVerifying(true);

    setBillingError(null);
    let pending: PendingBilling | null = null;
    try {
      pending = readPendingBilling(orgId);
    } catch {
      /* A valid receipt can recover unreadable local hints. */
    }

    try {
      const activeId =
        checkout?._id ??
        checkoutId ??
        (pending?.checkoutId as Id<"billingCheckouts"> | undefined);
      if (activeId) {
        const result = await verifyCheckout({
          checkoutId: activeId,
          sessionToken: getSessionToken() ?? "",
          txHash: hash,
        });
        if (result.status === "applied" || result.status === "reverted") {
          writePendingBilling(orgId, null);
          setHasPendingBilling(false);
          setCheckoutId(result.status === "applied" ? activeId : undefined);
          setTxHash(result.status === "applied" ? hash : undefined);
          setPaymentStep(result.status === "applied" ? "success" : "select");
          if (result.status === "reverted")
            setBillingError(
              "The original transaction reverted. No subscription payment was collected.",
            );
        }
        return;
      }
      // C-03: server verifies the on-chain payment first, then the plan is
      // activated. paidThroughAt is derived server-side from verified payment.
      await verifySubscriptionPayment({
        orgId: orgId as Id<"orgs">,
        sessionToken: getSessionToken() ?? "",
        plan: selectedPlan,
        txHash: hash,
      });

      await subscribe({
        orgId: orgId as Id<"orgs">,
        sessionToken: getSessionToken() ?? "",
        plan: selectedPlan,
        txHash: hash,
      });

      writePendingBilling(orgId, null);
      setHasPendingBilling(false);
      setTxHash(hash);
      setPaymentStep("success");
    } catch (caught) {
      let err = caught;
      if (
        err instanceof ConvexError &&
        err.data?.code === "BILLING_PAYMENT_REVERTED" &&
        err.data.txHash === hash.toLowerCase() &&
        pending?.hash?.toLowerCase() === hash.toLowerCase()
      ) {
        try {
          writePendingBilling(orgId, null);
          setHasPendingBilling(false);
          setTxHash(undefined);
          setManualTxHash("");
          setBillingError(userErrorMessage(err, 'Could not prepare checkout. Check the original request before trying again.'));
          setPaymentStep("select");
          return;
        } catch (storageError) {
          err = storageError;
        }
      }
      console.error("Failed to subscribe:", err);
      setBillingError(
        userErrorMessage(err, "Failed to subscribe"),
      );
      setPaymentStep("confirm");
    } finally {
      verificationLock.current = false;
      setIsVerifying(false);
    }
  };

  const checkOriginalCheckout = async (replacement = false) => {
    if (!checkout || isVerifying || !scope) return;
    setIsVerifying(true);
    setBillingError(null);
    try {
      if (replacement)
        await verifyReplacement({
          checkoutId: checkout._id,
          sessionToken: scope.sessionToken,
          txHash: manualTxHash,
        });
      else {
        const result = await verifyCheckout({
          checkoutId: checkout._id,
          sessionToken: scope.sessionToken,
        });
        if (!["applied", "reverted", "cancelled"].includes(result.status))
          setBillingError(
            "The original request has no confirmed receipt yet. It remains saved and will be checked again.",
          );
      }
    } catch (error) {
      setBillingError(
        userErrorMessage(error, "Could not check the original checkout."),
      );
    } finally {
      setIsVerifying(false);
    }
  };
  const discardCheckout = async () => {
    if (!checkout || !scope || isVerifying) return;
    setIsVerifying(true);
    try {
      await discardPrepared({
        checkoutId: checkout._id,
        sessionToken: scope.sessionToken,
      });
    } catch (error) {
      setBillingError(
        userErrorMessage(error, "Could not discard checkout."),
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const currentPlan = billing?.source === "trial" ? "trial" : billing?.effectiveTier?.key ?? billing?.plan ?? "trial";
  const isCurrentPlan = (plan: string) => currentPlan === plan;
  const includedWithoutSubscription = (plan: PlanKey) => !!billing?.isActive &&
    ["free", "complimentary"].includes(billing.source) && billing.expiresAt === null &&
    billing.limits.maxUsers >= PLAN_LIMITS[plan].maxUsers && billing.limits.maxBeneficiaries >= PLAN_LIMITS[plan].maxBeneficiaries;
  const canUpgrade = (plan: PlanKey) => {
    if (plan === "starter") return false;
    if (includedWithoutSubscription(plan)) return false;
    return !hasPaidTerm(billing) || PLANS[plan].price >= PLANS[billing!.plan as PlanKey].price;
  };
  return {
    checkout,
    currentCheckout,
    paymentConfig,
    checkoutPrice,
    canSendCheckout,
    checkOriginalCheckout,
    discardCheckout,
    hasPendingBilling,
    showPaymentModal,
    selectedPlan,
    selectedToken,
    manualTxHash,
    setManualTxHash,
    paymentStep,
    setPaymentStep,
    billingError,
    txHash,
    isSending,
    isConfirming,
    isVerifying,
    handleOpenPayment,
    handleClosePayment,
    handlePayWithWallet,
    handleConfirmPayment,
    currentPlan,
    isCurrentPlan,
    canUpgrade,
    includedWithoutSubscription,
  };
}
