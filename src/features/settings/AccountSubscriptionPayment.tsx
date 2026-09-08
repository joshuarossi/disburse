import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { circleConfiguration } from "../../../shared/circleExecution";
import { CustomerPaidExecution } from "@/features/payments/CustomerPaidExecution";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { userErrorMessage } from "@/lib/userErrors";
import type { useSettingsController } from "./useSettingsController";

export function AccountSubscriptionPayment({
  controller,
  onBusyChange,
}: {
  controller: ReturnType<typeof useSettingsController>;
  onBusyChange: (busy: boolean) => void;
}) {
  const {
    checkout,
    safes,
    selectedPlan,
    paymentConfig,
    orgId,
    setCheckoutId,
    isAdmin,
    currentUserRole,
    discardCheckout,
    isVerifying,
  } = controller;
  const sessionToken = useSessionToken(),
    create = useMutation(api.billingCheckoutData.create);
  const [selectedSafe, setSelectedSafe] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    lock = useRef(false);
  const accounts =
    safes?.filter(
      (s) => s.isActive !== false && s.chainId === paymentConfig?.chainId,
    ) ?? [];
  const safeId = selectedSafe || accounts[0]?._id;
  let supported = false;
  try {
    if (paymentConfig) {
      circleConfiguration(paymentConfig.chainId);
      supported = true;
    }
  } catch {
    /* The configured network is displayed without offering a native-fee fallback. */
  }
  const prepare = async () => {
    if (
      lock.current ||
      !sessionToken ||
      !orgId ||
      !paymentConfig ||
      !safeId ||
      !isAdmin
    )
      return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const id = await create({
        orgId: orgId as Id<"orgs">,
        sessionToken,
        requestId: crypto.randomUUID(),
        plan: selectedPlan,
        safeId: safeId as Id<"safes">,
        chainId: paymentConfig.chainId,
        treasury: paymentConfig.treasury,
        tokenAddress: paymentConfig.tokenAddress,
        amountRaw: String(BigInt(controller.checkoutPrice) * 1_000_000n),
      });
      setCheckoutId(id);
    } catch (e) {
      setError(
        userErrorMessage(
          e,
          "Could not prepare checkout. Check the saved subscription request before trying again.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <div className="space-y-4">
      {error && <Notice>{error}</Notice>}
      {checkout?.safeId ? (
        <>
          <dl className="workspace-detail-grid">
            <div>
              <dt>Pay from</dt>
              <dd>
                {safes?.find((s) => s._id === checkout.safeId)?.name ??
                  "Saved company account"}
              </dd>
            </div>
            <div>
              <dt>Subscription</dt>
              <dd>{controller.checkoutPrice} USDC for 30 days</dd>
            </div>
          </dl>
          <CustomerPaidExecution
            source={{ billingCheckoutId: checkout._id }}
            ready={checkout.status === "prepared"}
            blocked={
              !["admin", "approver"].includes(currentUserRole ?? "") ||
              isVerifying
            }
            memberName={(wallet) =>
              controller.members?.find(
                (m) => m?.walletAddress.toLowerCase() === wallet.toLowerCase(),
              )?.name ?? wallet
            }
            onBusyChange={(value) => {
              setBusy(value);
              onBusyChange(value);
            }}
            compact
          />
          {isAdmin && checkout.status === "prepared" && (
            <button
              className="workspace-action-link"
              disabled={isVerifying || busy}
              onClick={() => void discardCheckout()}
            >
              Discard unsubmitted checkout
            </button>
          )}
        </>
      ) : checkout ? (
        <Notice tone="info">
          This checkout was prepared with the previous wallet flow. Discard it
          to choose a company account and pay execution fees in USDC.
        </Notice>
      ) : (
        <>
          <p className="workspace-description">
            Pay from a company account. Its owners approve the subscription and
            a separate execution fee in USDC. Your connected wallet only signs
            approvals.
          </p>
          {!supported ? (
            <Notice tone="info">
              USDC execution fees are not available on the configured billing
              network. Checkout is unavailable until a supported billing
              destination is configured.
            </Notice>
          ) : safes === undefined ? (
            <p role="status" className="workspace-description">
              Loading company accounts…
            </p>
          ) : !accounts.length ? (
            <Notice tone="info">
              Add a company account on {paymentConfig?.network} to pay this
              subscription.
            </Notice>
          ) : (
            <>
              <label className="workspace-field">
                <span>Pay from</span>
                <select
                  value={safeId}
                  onChange={(e) => setSelectedSafe(e.target.value)}
                  disabled={busy || !isAdmin}
                >
                  {accounts.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name ?? "Company account"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="workspace-button workspace-button-primary w-full"
                disabled={busy || !isAdmin}
                onClick={() => void prepare()}
              >
                {busy ? "Preparing checkout…" : "Review subscription payment"}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
