import { useState } from "react";
import { AccountSubscriptionPayment } from "./AccountSubscriptionPayment";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  ExternalLink,
  CheckCircle,
} from "lucide-react";
import { PLANS } from "@/lib/billingPlans";
import type { useSettingsController } from "./useSettingsController";
export function BillingPaymentDialog({
  controller,
}: {
  controller: ReturnType<typeof useSettingsController>;
}) {
  const {
    showPaymentModal,
    hasPendingBilling,
    checkout,
    checkoutPrice,
    canSendCheckout,
    checkOriginalCheckout,
    discardCheckout,
    selectedPlan,
    selectedToken,
    manualTxHash,
    setManualTxHash,
    paymentStep,
    setPaymentStep,
    billingError,
    txHash,
    handleClosePayment,
    handleConfirmPayment,
    paymentConfig,
    isVerifying,
    billing,
  } = controller;
  const [accountBusy, setAccountBusy] = useState(false);
  return (
    <>
      {showPaymentModal && (
        <Dialog
          title={
            paymentStep === "success"
              ? "Payment successful"
              : `Subscribe to ${PLANS[selectedPlan].name}`
          }
          onClose={() => { if (!accountBusy) handleClosePayment(); }}
        >
          <div className="p-6">
            <p className="workspace-description mb-5">
              {paymentConfig
                ? `${paymentConfig.testnet ? "Test billing · use test tokens only. " : ""}USDC on ${paymentConfig.network}. Each payment buys 30 days. No automatic charges.`
                : "Subscription checkout is unavailable until the payment destination is configured."}
            </p>
            {billing?.licenseGrant && paymentStep !== "success" && <p className="workspace-description mb-5">A confirmed subscription payment replaces the current trial or complimentary grant. Any free fallback tier remains available when paid access ends. You pay the network fee for this payment.</p>}
            {/* Error Message */}
            {billingError && (
              <div
                role="alert"
                className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
              >
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {billingError}
              </div>
            )}

            {paymentStep === "select" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-white">
                        {PLANS[selectedPlan].name} Plan
                      </p>
                      <p className="text-sm text-slate-400">
                        {PLANS[selectedPlan].description}
                      </p>
                    </div>
                    <p className="text-2xl font-bold text-white">
                      ${checkoutPrice}
                    </p>
                  </div>
                </div>

                {!hasPendingBilling && <AccountSubscriptionPayment controller={controller} onBusyChange={setAccountBusy} />}
                {!checkout?.safeId && <Button variant="secondary" className="w-full" onClick={() => setPaymentStep("confirm")} disabled={!paymentConfig}>Verify an existing payment</Button>}

                {checkout?.status === "prepared" && !checkout.safeId && (
                  <div className="space-y-2">
                    <p className="workspace-description">
                      This checkout is saved for your team.{" "}
                      {canSendCheckout
                        ? "No wallet payment has been requested."
                        : "Connect the administrator wallet that prepared it to pay."}
                    </p>
                    <Button
                      variant="secondary"
                      disabled={isVerifying}
                      onClick={() => void discardCheckout()}
                    >
                      Discard unsubmitted checkout
                    </Button>
                  </div>
                )}
              </div>
            )}

            {paymentStep === "confirm" && (
              <div className="space-y-4">
                {checkout && (
                  <section
                    aria-label="Subscription payment recovery"
                    className="rounded-lg border border-[var(--ws-border)] p-4 space-y-3"
                  >
                    <h3 className="font-semibold">
                      Check the original payment
                    </h3>
                    <p className="workspace-description">
                      Your team has one saved request for this subscription. We
                      can find its receipt even if the wallet did not return a
                      reference.
                    </p>
                    <Button
                      disabled={isVerifying}
                      onClick={() => void checkOriginalCheckout()}
                    >
                      Check original payment
                    </Button>
                  </section>
                )}
                <p className="text-slate-400">
                  Enter the transaction hash of your payment to verify.
                </p>

                <div>
                  <label
                    htmlFor="billing-tx-hash"
                    className="block text-sm font-medium text-slate-300 mb-2"
                  >
                    Payment transaction hash
                  </label>
                  <input
                    id="billing-tx-hash"
                    type="text"
                    value={manualTxHash}
                    onChange={(e) => setManualTxHash(e.target.value)}
                    placeholder="0x..."
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none"
                  />
                </div>
                {checkout && (
                  <details className="text-sm">
                    <summary className="cursor-pointer">
                      Cancelled or replaced the transaction in your wallet?
                    </summary>
                    <p className="workspace-description mt-3">
                      Paste that transaction's hash above. We will verify that
                      it consumed the original transaction number before
                      releasing this checkout.
                    </p>
                    <Button
                      className="mt-3"
                      variant="secondary"
                      disabled={
                        isVerifying || !/^0x[0-9a-f]{64}$/i.test(manualTxHash)
                      }
                      onClick={() => void checkOriginalCheckout(true)}
                    >
                      Verify replacement receipt
                    </Button>
                  </details>
                )}

                <div className="rounded-lg border border-white/10 bg-navy-800/50 p-4">
                  <p className="text-sm text-slate-400">Expected payment:</p>
                  <p className="mt-1 font-medium text-white">
                    {checkoutPrice} {selectedToken} to
                  </p>
                  <p className="mt-1 font-mono text-sm text-slate-400 break-all">
                    {paymentConfig?.treasury ?? ""}
                  </p>
                </div>

                <div className="flex gap-3">
                  <Button
                    className="flex-1"
                    onClick={() => handleConfirmPayment(manualTxHash)}
                    disabled={
                      !manualTxHash.trim() || isVerifying || !paymentConfig
                    }
                  >
                    {isVerifying ? "Verifying payment…" : "Verify payment"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={isVerifying}
                    onClick={() => setPaymentStep("select")}
                  >
                    Back
                  </Button>
                </div>
              </div>
            )}

            {paymentStep === "success" && (
              <div className="space-y-4 text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-green-400" />
                <div>
                  <p className="text-xl font-medium text-white">
                    Payment applied
                  </p>
                  <p className="mt-2 text-slate-400">
                    This receipt has been applied to your subscription. Plan &
                    billing shows your current plan and paid access date.
                  </p>
                </div>
                {txHash && (
                  <a
                    href={`${paymentConfig?.explorer}/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-accent-400 hover:underline"
                  >
                    View receipt
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <Button className="w-full" onClick={handleClosePayment}>
                  Done
                </Button>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
