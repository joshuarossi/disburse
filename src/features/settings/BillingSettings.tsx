import { Button } from "@/components/ui/button";
import { CreditCard, Check } from "lucide-react";
import { getPlanFeatures, PLANS, type PlanKey } from "@/lib/billingPlans";
import type { useSettingsController } from "./useSettingsController";
import { billingAccess, AVAILABLE_PAID_PLANS } from "../../../shared/billing";
export function BillingSettings({
  controller,
}: {
  controller: ReturnType<typeof useSettingsController>;
}) {
  const {
    t,
    billing,
    handleOpenPayment,
    isCurrentPlan,
    canUpgrade,
    isAdmin,
    currentCheckout,
    includedWithoutSubscription,
  } = controller;
  const nextAccess = billing?.expiresAt ? billingAccess(billing, billing.expiresAt) : null;
  const freeAccess = billing && ["free", "complimentary"].includes(billing.source);
  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
              <CreditCard className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-white">
                {t("settings.billing.title")}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                {t("settings.billing.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {freeAccess && <div className="rounded-full bg-green-500/10 px-3 py-2 text-xs font-medium text-green-400">{t("settings.billing.noSubscriptionCharge")}</div>}
            {billing?.status === "trial" && (
              <div className="billing-trial-badge rounded-full bg-yellow-500/10 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-yellow-400">
                {t("settings.billing.trialDaysLeft", {
                  days: billing.daysRemaining,
                })}
              </div>
            )}
            {billing?.status === "active" && (
              <div className="rounded-full bg-green-500/10 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-green-400">
                {t("settings.billing.activeDaysRemaining", {
                  days: billing.daysRemaining,
                })}
              </div>
            )}
          </div>
        </div>

        <p className="workspace-description mb-4">
          {t(freeAccess && billing.expiresAt === null ? "settings.billing.freePolicy" : nextAccess?.isActive ? "settings.billing.fallbackPolicy" : "settings.billing.expiryPolicy", { tier: nextAccess?.effectiveTier.name })}
        </p>
        {/* Current Plan Status */}
        <div className="mb-4 sm:mb-6 rounded-xl border border-white/10 bg-navy-800/50 p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-xs sm:text-sm text-slate-400">
                {t("settings.billing.currentPlan")}
              </p>
              <p className="text-lg sm:text-xl font-bold text-white capitalize">
                {billing?.effectiveTier.name || "Loading..."}
              </p>
            </div>
          </div>
          {billing?.limits && billing.usage ? (
            <section
              aria-label={t("settings.billing.usageTitle")}
              className="mt-4 border-t border-[var(--ws-border)] pt-4"
            >
              <h3 className="text-sm font-semibold">
                {t("settings.billing.usageTitle")}
              </h3>
              <dl className="workspace-detail-grid mt-3">
                <div>
                  <dt>{t("settings.billing.memberSeats")}</dt>
                  <dd>
                    {Number.isFinite(billing.limits.maxUsers)
                      ? t("settings.billing.usedOf", {
                          used: billing.usage.reservedSeats,
                          limit: billing.limits.maxUsers,
                        })
                      : t("settings.billing.noPlanLimit", {
                          used: billing.usage.reservedSeats,
                        })}
                    <p className="workspace-description !text-xs">
                      {t("settings.billing.seatBreakdown", {
                        active: billing.usage.activeMembers,
                        pending: billing.usage.pendingInvitations,
                      })}
                    </p>
                  </dd>
                </div>
                <div>
                  <dt>{t("settings.billing.savedRecipients")}</dt>
                  <dd>
                    {Number.isFinite(billing.limits.maxBeneficiaries)
                      ? t("settings.billing.usedOf", {
                          used: billing.usage.recipients,
                          limit: billing.limits.maxBeneficiaries,
                        })
                      : t("settings.billing.noPlanLimit", {
                          used: billing.usage.recipients,
                        })}
                    <p className="workspace-description !text-xs">
                      {t("settings.billing.archivedCount", {
                        count: billing.usage.archivedRecipients,
                      })}
                    </p>
                  </dd>
                </div>
                <div>
                  <dt>{t("settings.billing.connectedAccounts")}</dt>
                  <dd>
                    {billing.usage.activeAccounts}
                    <p className="workspace-description !text-xs">
                      {t("settings.billing.accountsIncluded")}
                    </p>
                  </dd>
                </div>
              </dl>
              {(billing.usage.reservedSeats > billing.limits.maxUsers || billing.usage.recipients > billing.limits.maxBeneficiaries) && <p className="workspace-description mt-4">{t("settings.billing.overLimitPolicy")}</p>}
            </section>
          ) : (
            billing && (
              <p role="status" className="workspace-description mt-3">
                {t("settings.billing.usageUnavailable")}
              </p>
            )
          )}
        </div>

        {billing?.expiresAt && (
          <p className="workspace-description mb-4">
            {t(
              billing.source === "trial"
                ? "settings.billing.trialEnd"
                : billing.source === "complimentary" ? "settings.billing.complimentaryEnd"
                : "settings.billing.paidEnd",
              { date: new Date(billing.expiresAt).toLocaleString() },
            )}
          </p>
        )}
        <p className="workspace-description mb-5">
          {t("settings.billing.included")}
        </p>
        {currentCheckout && (
          <section
            aria-label="Saved subscription checkout"
            className="mb-5 rounded-lg border border-[var(--ws-border)] p-4 space-y-3"
          >
            <h3 className="font-semibold">Subscription request in progress</h3>
            <p className="workspace-description">
              {currentCheckout.status === "prepared"
                ? "Your team has prepared a checkout. Review it before asking the wallet to pay."
                : "The original wallet request is saved. Review its status before making another subscription payment."}
            </p>
            <Button
              variant="secondary"
              onClick={() => handleOpenPayment(currentCheckout.plan)}
            >
              Review saved checkout
            </Button>
          </section>
        )}
        {/* Available Plans */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          {AVAILABLE_PAID_PLANS.map(key => [key, PLANS[key]] as [PlanKey, (typeof PLANS)[PlanKey]]).map(
            ([key, plan]) => {
              const Icon = plan.icon;
              const isCurrent = isCurrentPlan(key);
              const canSelectPlan = canUpgrade(key);

              return (
                <div
                  key={key}
                  className={`relative rounded-xl border p-4 ${
                    plan.popular
                      ? "border-accent-500/50 bg-gradient-to-br from-accent-500/10 to-transparent"
                      : "border-white/10 bg-navy-800/30"
                  }`}
                >
                  {plan.popular && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-accent-500 px-2 py-0.5 text-xs font-medium text-[#102624]">
                      {t("settings.billing.popular")}
                    </span>
                  )}

                  {isCurrent && (
                    <span className="absolute -top-2 right-3 rounded-full bg-green-500 px-2 py-0.5 text-xs font-medium text-[#102624]">
                      {t("settings.billing.current")}
                    </span>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        plan.popular
                          ? "bg-accent-500/20 text-accent-400"
                          : "bg-navy-700 text-slate-400"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">
                        {t(`settings.billing.plans.${key}.name`)}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {t(`settings.billing.plans.${key}.description`)}
                      </p>
                    </div>
                  </div>

                  <div className="mb-3">
                    <span className="text-2xl font-bold text-white">
                      {t(`settings.billing.plans.${key}.price`, {
                        price: plan.price,
                      })}
                    </span>
                  </div>

                  <ul className="space-y-1 mb-4 text-xs">
                    {getPlanFeatures(key)
                      .slice(0, 3)
                      .map((feature) => {
                        return (
                          <li
                            key={feature.key}
                            className="flex items-center gap-2 text-slate-300"
                          >
                            <Check
                              className={`h-3 w-3 ${plan.popular ? "text-accent-400" : "text-green-400"}`}
                            />
                            {t(`settings.billing.features.${feature.key}`, {
                              defaultValue: feature.text,
                              count: feature.count,
                            })}
                          </li>
                        );
                      })}
                  </ul>

                  <Button
                    className="w-full"
                    size="sm"
                    variant={plan.popular ? "default" : "secondary"}
                    disabled={!isAdmin || !canSelectPlan}
                    onClick={() => handleOpenPayment(key)}
                  >
                    {!isAdmin
                      ? "Admin required"
                      : includedWithoutSubscription(key) ? t("settings.billing.includedFree")
                      : isCurrent && billing?.source === "paid"
                        ? "Renew for 30 days"
                        : !canSelectPlan
                          ? "Available after expiry"
                          : billing?.source !== "paid"
                            ? "Choose plan"
                            : "Change plan"}
                  </Button>
                </div>
              );
            },
          )}
        </div>

        <div className="mt-6">
          <h3 className="font-semibold text-white mb-3">Payment history</h3>
          {billing?.payments?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr>
                    <th className="p-2">Date</th>
                    <th className="p-2">Plan</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.payments.map((payment) => (
                    <tr key={payment._id}>
                      <td className="p-2">
                        {new Date(payment.verifiedAt).toLocaleDateString()}
                      </td>
                      <td className="p-2 capitalize">{payment.plan}</td>
                      <td className="p-2">
                        {payment.redeemedAt !== undefined
                          ? "Applied"
                          : "Verified"}
                      </td>
                      <td className="p-2">
                        <a
                          className="underline"
                          target="_blank"
                          rel="noreferrer"
                          href={`${payment.chainId === 11155111 ? "https://sepolia.etherscan.io" : "https://etherscan.io"}/tx/${payment.txHash}`}
                        >
                          View transaction
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="workspace-description">
              No subscription payments recorded yet.
            </p>
          )}
        </div>

        {/* Payment Info */}
        <div className="mt-6 pt-6 border-t border-white/10">
          <p className="text-sm text-slate-400">
            {t(
              freeAccess ? "settings.billing.freeTerms" : billing?.source === "trial"
                ? "settings.billing.trialTerms"
                : "settings.billing.paidTerms",
            )}
          </p>
        </div>
      </div>
    </>
  );
}
