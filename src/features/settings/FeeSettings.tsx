import { Button } from "@/components/ui/button";
import { Loader2, Save, Rocket } from "lucide-react";
import {
  RELAY_FEATURE_ENABLED,
  SUPPORTED_RELAY_FEE_TOKENS,
  type RelayFeeTokenSymbol,
} from "@/lib/relayConfig";
import type { useSettingsController } from "./useSettingsController";
export function FeeSettings({
  controller,
}: {
  controller: ReturnType<typeof useSettingsController>;
}) {
  const {
    t,
    relayFeeTokenSymbol,
    setRelayFeeTokenSymbol,
    savingRelaySettings,
    relaySettingsError,
    isAdmin,
    handleSaveRelaySettings,
    relaySettingsChanged,
  } = controller;
  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4 sm:mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
            <Rocket className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-white">
              {t("settings.relay.title")}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              {t("settings.relay.subtitle")}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="payment-fee-currency"
              className="mb-2 block text-sm font-medium text-slate-300"
            >
              {t("settings.relay.feeTokenLabel")}
            </label>
            <select
              id="payment-fee-currency"
              value={relayFeeTokenSymbol}
              onChange={(e) =>
                setRelayFeeTokenSymbol(e.target.value as RelayFeeTokenSymbol)
              }
              disabled={!isAdmin || !RELAY_FEATURE_ENABLED}
              className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white disabled:opacity-50"
            >
              {SUPPORTED_RELAY_FEE_TOKENS.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">
              {t("settings.relay.feeTokenDescription")}
            </p>
          </div>

          <p className="text-sm text-slate-400">
            You review the fee before approving each payment. The managed payment service handles network gas; recipient amounts and currencies stay unchanged.
          </p>
          {!RELAY_FEATURE_ENABLED && <p className="text-sm text-amber-400">Managed payments are disabled in this environment.</p>}

          {relaySettingsError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              {relaySettingsError}
            </div>
          )}

          {isAdmin ? (
            <Button
              onClick={handleSaveRelaySettings}
              disabled={
                !relaySettingsChanged ||
                savingRelaySettings ||
                !RELAY_FEATURE_ENABLED
              }
              className="w-full sm:w-auto h-11"
            >
              {savingRelaySettings ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t("settings.relay.save")}
            </Button>
          ) : (
            <p className="text-sm text-slate-500">
              {t("settings.relay.adminOnly")}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
