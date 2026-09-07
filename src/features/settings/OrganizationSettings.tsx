import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { Button } from "@/components/ui/button";
import { Building2, Loader2, Save } from "lucide-react";
import type { useSettingsController } from "./useSettingsController";
export function OrganizationSettings({
  controller,
}: {
  controller: ReturnType<typeof useSettingsController>;
}) {
  const {
    orgNameError,
    t,
    orgName,
    setOrgName,
    isEditingName,
    setIsEditingName,
    savingName,
    isAdmin,
    handleSaveOrgName,
  } = controller;
  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4 sm:mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-white">
              {t("settings.organization.title")}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              {t("settings.organization.subtitle")}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {orgNameError && <Notice>{orgNameError}</Notice>}
          <div>
            <label
              htmlFor="organization-name"
              className="mb-2 block text-sm font-medium text-slate-300"
            >
              {t("settings.organization.orgName")}
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                id="organization-name"
                type="text"
                value={orgName}
                onChange={(e) => {
                  setOrgName(e.target.value);
                  setIsEditingName(true);
                }}
                disabled={!isAdmin}
                className="flex-1 rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white disabled:opacity-50"
              />
              {isAdmin && isEditingName && (
                <Button
                  onClick={handleSaveOrgName}
                  disabled={savingName}
                  className="w-full sm:w-auto h-11"
                >
                  {savingName ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t("settings.organization.save")}
                </Button>
              )}
            </div>
            {!isAdmin && (
              <p className="mt-2 text-sm text-slate-500">
                {t("settings.organization.adminOnly")}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
