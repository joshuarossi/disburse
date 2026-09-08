import { Button } from "@/components/ui/button";
import { Wallet, ArrowUpRight, Loader2, AlertCircle } from "lucide-react";
import { CHAINS_LIST, getChainName, getSafeAppUrl } from "@/lib/chains";
import type { useSettingsController } from "./useSettingsController";
import { useState } from "react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { AccountNameEditor } from "@/features/treasury/AccountNameEditor";
import { CompanyAccountSetup } from "./CompanyAccountSetup";
import { AccountFeeSetup } from "./AccountFeeSetup";
export function AccountSettings({
  controller,
}: {
  controller: ReturnType<typeof useSettingsController>;
}) {
  const [renaming, setRenaming] = useState<Doc<"safes"> | null>(null);
  const {
    t,
    safeAddress,
    setSafeAddress,
    accountName,
    setAccountName,
    selectedChainId,
    setSelectedChainId,
    isLinking,
    setIsLinking,
    linkingError,
    setLinkingError,
    isValidating,
    safes,
    availableChainsToLink,
    isAdmin,
    handleLinkSafe,
    handleUnlinkSafe,
    SEPOLIA_CHAIN_ID,
  } = controller;
  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4 sm:mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-white">
              {t("settings.safe.title")}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Separate your operations, payroll and reserves into named
              accounts.
            </p>
          </div>
        </div>

        <CompanyAccountSetup controller={controller} />
        {linkingError && !isLinking && (
          <p role="alert" className="mb-4 text-sm text-red-400">
            {linkingError}
          </p>
        )}
        {safes && safes.length > 0 ? (
          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Connected accounts
              </label>
              <div className="space-y-2">
                {safes.map((safe) => {
                  return (
                    <div
                      key={safe._id}
                      className="rounded-lg border border-white/10 bg-navy-800 p-4"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                            {getChainName(safe.chainId)}
                          </span>
                          <div className="text-xs text-slate-400">
                            <p className="font-medium text-white">
                              {safe.name ??
                                `${getChainName(safe.chainId)} account`}
                            </p>
                            <p className="font-mono">
                              {safe.safeAddress.slice(0, 6)}…
                              {safe.safeAddress.slice(-4)}
                            </p>
                            {safe.threshold && (
                              <p>
                                {safe.threshold} of {safe.owners?.length}{" "}
                                signatures when linked
                              </p>
                            )}
                          </div>
                          <a
                            href={getSafeAppUrl(safe.chainId, safe.safeAddress)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-sm text-accent-400 hover:text-accent-300 transition-colors"
                          >
                            {t("settings.safe.openSafe")}
                            <ArrowUpRight className="h-4 w-4" />
                          </a>
                        </div>
                        {isAdmin && (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setRenaming(safe)}
                            >
                              Rename
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleUnlinkSafe(safe._id)}
                              className="w-full sm:w-auto"
                            >
                              {t("settings.safe.unlinkSafe")}
                            </Button>
                          </div>
                        )}
                      </div>
                      <AccountFeeSetup
                        account={safe}
                        isAdmin={isAdmin}
                        canApprove={controller.canApprove}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {isAdmin && availableChainsToLink.length > 0 && !isLinking && (
              <Button
                variant="secondary"
                onClick={() => {
                  setIsLinking(true);
                  setSafeAddress("");
                  setSelectedChainId(availableChainsToLink[0].chainId);
                }}
                className="w-full sm:w-auto h-11"
              >
                Connect another account
              </Button>
            )}
          </div>
        ) : null}
        {isLinking ? (
          <form onSubmit={handleLinkSafe} className="mt-6 space-y-6">
            <label className="block">
              <span className="finance-label">Account name</span>
              <input
                className="finance-field"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="e.g. Operations or Payroll"
                maxLength={80}
                required
              />
            </label>
            <div>
              <label
                htmlFor="funding-account-address"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                {t("settings.safe.safeAddress")}
              </label>
              <input
                id="funding-account-address"
                type="text"
                value={safeAddress}
                onChange={(e) => {
                  setSafeAddress(e.target.value);
                  setLinkingError(null);
                }}
                placeholder="0x..."
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 font-mono text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                required
              />
              <p className="mt-2 text-xs text-slate-500">
                {t("settings.safe.safeAddressDescription")}
              </p>
            </div>

            <div>
              <label
                htmlFor="funding-account-network"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                {t("settings.safe.chain", { defaultValue: "Chain" })}
              </label>
              <select
                id="funding-account-network"
                value={selectedChainId}
                onChange={(e) => setSelectedChainId(Number(e.target.value))}
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              >
                {(safes && safes.length > 0
                  ? availableChainsToLink
                  : CHAINS_LIST
                ).map((c) => (
                  <option key={c.chainId} value={c.chainId}>
                    {c.chainName}
                  </option>
                ))}
              </select>
            </div>

            {linkingError && (
              <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
                <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-400">{linkingError}</p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                type="submit"
                disabled={isValidating}
                className="w-full sm:w-auto h-11"
              >
                {isValidating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("settings.safe.validating")}
                  </>
                ) : (
                  t("settings.safe.linkSafe")
                )}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setIsLinking(false);
                  setLinkingError(null);
                }}
                className="w-full sm:w-auto h-11"
              >
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        ) : null}
        {(!safes || safes.length === 0) && !isLinking ? (
          <div className="text-center py-6">
            <Wallet className="mx-auto h-12 w-12 text-slate-500" />
            <p className="mt-4 text-sm sm:text-base text-slate-400">
              {t("settings.safe.noSafe")}
            </p>
            {isAdmin && (
              <Button
                className="mt-4 w-full sm:w-auto h-11"
                onClick={() => {
                  setIsLinking(true);
                  setSelectedChainId(SEPOLIA_CHAIN_ID);
                }}
              >
                {t("settings.safe.linkExisting")}
              </Button>
            )}
            <p className="mt-4 text-xs sm:text-sm text-slate-500">
              {t("settings.safe.createSafe")}{" "}
              <a
                href="https://app.safe.global/new-safe/create"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-400 hover:underline"
              >
                {t("settings.safe.createSafeLink")}
              </a>
            </p>
          </div>
        ) : null}
      </div>
      {renaming && (
        <AccountNameEditor
          account={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
    </>
  );
}
