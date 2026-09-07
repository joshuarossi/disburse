import { Loader2, Shield } from 'lucide-react';
import type { useSettingsController } from './useSettingsController';
import { ScreeningSource } from './ScreeningSource';
export function ScreeningSettings({
  controller,
}: {
  controller: ReturnType<typeof useSettingsController>;
}) {
  const {
    t,
    isAdmin,
    screeningEnforcement,
    savingEnforcement,
    handleUpdateEnforcement,
  } = controller;
  return (
    <>
      <ScreeningSource isAdmin={isAdmin} />
      <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4 sm:mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
            <Shield className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-white">
              {t('settings.screening.title')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              {t('settings.screening.subtitle')}
            </p>
            <p className="text-sm text-slate-400 mt-2">{t('screening.scope')}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              {t('settings.screening.enforcement')}
            </label>
            <p className="mb-4 text-xs sm:text-sm text-slate-400">
              {t('settings.screening.enforcementDescription')}
            </p>

            {!isAdmin && (
              <p className="mb-4 text-sm text-slate-500">
                {t('settings.screening.adminOnly')}
              </p>
            )}

            {screeningEnforcement === undefined ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="space-y-3">
                {/* Off Option */}
                <label
                  className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                    screeningEnforcement === 'off'
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-white/10 bg-navy-800/30 hover:border-white/20'
                  } ${!isAdmin || savingEnforcement ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="screeningEnforcement"
                    value="off"
                    checked={screeningEnforcement === 'off'}
                    onChange={() =>
                      isAdmin &&
                      !savingEnforcement &&
                      handleUpdateEnforcement('off')
                    }
                    disabled={!isAdmin || savingEnforcement}
                    className="mt-1 h-4 w-4 text-accent-500 focus:ring-accent-500 focus:ring-offset-navy-900"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-white">
                        {t('settings.screening.options.off')}
                      </span>
                      {savingEnforcement && screeningEnforcement === 'off' && (
                        <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-slate-400">
                      {t('settings.screening.options.offDescription')}
                    </p>
                  </div>
                </label>

                {/* Warn Option */}
                <label
                  className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                    screeningEnforcement === 'warn'
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-white/10 bg-navy-800/30 hover:border-white/20'
                  } ${!isAdmin || savingEnforcement ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="screeningEnforcement"
                    value="warn"
                    checked={screeningEnforcement === 'warn'}
                    onChange={() =>
                      isAdmin &&
                      !savingEnforcement &&
                      handleUpdateEnforcement('warn')
                    }
                    disabled={!isAdmin || savingEnforcement}
                    className="mt-1 h-4 w-4 text-accent-500 focus:ring-accent-500 focus:ring-offset-navy-900"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-white">
                        {t('settings.screening.options.warn')}
                      </span>
                      {savingEnforcement && screeningEnforcement === 'warn' && (
                        <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-slate-400">
                      {t('settings.screening.options.warnDescription')}
                    </p>
                  </div>
                </label>

                {/* Block Option */}
                <label
                  className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                    screeningEnforcement === 'block'
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-white/10 bg-navy-800/30 hover:border-white/20'
                  } ${!isAdmin || savingEnforcement ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="screeningEnforcement"
                    value="block"
                    checked={screeningEnforcement === 'block'}
                    onChange={() =>
                      isAdmin &&
                      !savingEnforcement &&
                      handleUpdateEnforcement('block')
                    }
                    disabled={!isAdmin || savingEnforcement}
                    className="mt-1 h-4 w-4 text-accent-500 focus:ring-accent-500 focus:ring-offset-navy-900"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-white">
                        {t('settings.screening.options.block')}
                      </span>
                      {savingEnforcement &&
                        screeningEnforcement === 'block' && (
                          <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                        )}
                    </div>
                    <p className="text-xs sm:text-sm text-slate-400">
                      {t('settings.screening.options.blockDescription')}
                    </p>
                  </div>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
