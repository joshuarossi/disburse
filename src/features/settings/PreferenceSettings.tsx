import { ThemeSwitcher } from "@/components/ui/ThemeSwitcher";
import { SlidersHorizontal } from "lucide-react";
import type { useSettingsController } from "./useSettingsController";
export function PreferenceSettings({
  controller,
}: {
  controller: ReturnType<typeof useSettingsController>;
}) {
  const { t } = controller;
  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4 sm:mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
            <SlidersHorizontal className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-white">
              {t("settings.preferences.title")}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              {t("settings.preferences.subtitle")}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-slate-300 shrink-0">
              Workspace language
            </span>
            <span className="text-sm">English</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <label className="text-sm font-medium text-slate-300 shrink-0">
              {t("settings.appearance.selectTheme")}
            </label>
            <div className="w-56 rounded-lg border border-white/10 bg-navy-800/50 p-1">
              <ThemeSwitcher variant="secondary" size="default" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
