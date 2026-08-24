import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Id } from '../../../convex/_generated/dataModel';

// Extracted verbatim from src/pages/Disbursements.tsx (M-04 decomposition).

export type ScreeningWarningState =
  | {
      flagged: Array<{ beneficiaryId: string; beneficiaryName: string; status: string }>;
      action: 'create';
      data: { isBatch: boolean };
    }
  | {
      flagged: Array<{ beneficiaryId: string; beneficiaryName: string; status: string }>;
      action: 'propose';
      data: { disbursement: { _id: Id<'disbursements'>; chainId?: number; safeTxHash?: string } };
    }
  | {
      flagged: Array<{ beneficiaryId: string; beneficiaryName: string; status: string }>;
      action: 'execute';
      data: { disbursement: { _id: Id<'disbursements'>; chainId?: number; safeTxHash?: string } };
    };

interface CancelConfirmModalProps {
  cancelDisbursementId: Id<'disbursements'> | null;
  setCancelDisbursementId: (id: null) => void;
  confirmCancel: () => void;
}

export function CancelConfirmModal({
  cancelDisbursementId,
  setCancelDisbursementId,
  confirmCancel,
}: CancelConfirmModalProps) {
  const { t } = useTranslation();

  return (
    <>
              {cancelDisbursementId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCancelDisbursementId(null)}>
            <div
              className="rounded-2xl border border-white/10 bg-navy-900 p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  {t('disbursements.actions.cancel')} Disbursement
                </h2>
                <button
                  onClick={() => setCancelDisbursementId(null)}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <p className="text-sm text-slate-300 mb-6">
                {t('disbursements.actions.cancelConfirm')}
              </p>

              <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setCancelDisbursementId(null)}
                  className="w-full sm:w-auto"
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={confirmCancel}
                  className="w-full sm:w-auto bg-red-500 hover:bg-red-600 text-white"
                >
                  Yes, Cancel Disbursement
                </Button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}

interface RescheduleModalProps {
  rescheduleDisbursementId: Id<'disbursements'> | null;
  setRescheduleDisbursementId: (id: null) => void;
  newScheduledAt: string;
  setNewScheduledAt: (v: string) => void;
  newScheduledAtError: string | null;
  setNewScheduledAtError: (v: string | null) => void;
  validateScheduledAt: (value: string) => string | null;
  handleReschedule: () => void;
}

export function RescheduleModal({
  rescheduleDisbursementId,
  setRescheduleDisbursementId,
  newScheduledAt,
  setNewScheduledAt,
  newScheduledAtError,
  setNewScheduledAtError,
  validateScheduledAt,
  handleReschedule,
}: RescheduleModalProps) {
  const { t } = useTranslation();

  return (
    <>
              {rescheduleDisbursementId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => {
              setRescheduleDisbursementId(null);
              setNewScheduledAt('');
              setNewScheduledAtError(null);
            }}
          >
            <div
              className="rounded-2xl border border-white/10 bg-navy-900 p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  {t('disbursements.actions.rescheduleTitle')}
                </h2>
                <button
                  onClick={() => {
                    setRescheduleDisbursementId(null);
                    setNewScheduledAt('');
                    setNewScheduledAtError(null);
                  }}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <p className="text-sm text-slate-300 mb-4">
                {t('disbursements.actions.rescheduleConfirm')}
              </p>

              <div className="mb-6">
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('disbursements.form.scheduleFor')}
                </label>
                <input
                  type="datetime-local"
                  value={newScheduledAt}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setNewScheduledAt(nextValue);
                    setNewScheduledAtError(validateScheduledAt(nextValue));
                  }}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
                {newScheduledAtError && (
                  <p className="mt-1 text-xs text-red-400">
                    {newScheduledAtError}
                  </p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRescheduleDisbursementId(null);
                    setNewScheduledAt('');
                  }}
                  className="w-full sm:w-auto"
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleReschedule}
                  className="w-full sm:w-auto"
                >
                  {t('disbursements.actions.reschedule')}
                </Button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}

interface ScreeningWarningModalProps {
  screeningWarning: ScreeningWarningState | null;
  setScreeningWarning: Dispatch<SetStateAction<ScreeningWarningState | null>>;
  handleCreate: (e: React.FormEvent, skipScreening?: boolean) => void | Promise<void>;
  handlePropose: (
    disbursement: { _id: Id<'disbursements'>; chainId?: number; safeTxHash?: string },
    skipScreening?: boolean
  ) => void | Promise<void>;
  handleExecute: (
    disbursement: { _id: Id<'disbursements'>; chainId?: number; safeTxHash?: string },
    skipScreening?: boolean
  ) => void | Promise<void>;
}

export function ScreeningWarningModal({
  screeningWarning,
  setScreeningWarning,
  handleCreate,
  handlePropose,
  handleExecute,
}: ScreeningWarningModalProps) {
  return (
    <>
              {screeningWarning && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setScreeningWarning(null)}>
            <div
              className="rounded-2xl border border-yellow-500/30 bg-navy-900 p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-yellow-400">
                  SDN Screening Warning
                </h2>
                <button
                  onClick={() => setScreeningWarning(null)}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mb-6 space-y-3">
                <p className="text-sm text-slate-300">
                  The following beneficiary(ies) have potential or confirmed SDN matches:
                </p>
                <ul className="space-y-2">
                  {screeningWarning.flagged.map((f) => (
                    <li key={f.beneficiaryId} className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-3">
                      <p className="text-sm font-medium text-white">{f.beneficiaryName}</p>
                      <p className="text-xs text-yellow-400 capitalize">{f.status.replace('_', ' ')}</p>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-slate-400">
                  Proceeding with this transaction may violate sanctions regulations. Please review the screening results before continuing.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setScreeningWarning(null)}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    const warning = screeningWarning;
                    setScreeningWarning(null);
                    if (!warning) return;

                    if (warning.action === 'create') {
                      // Re-create the form event and call handleCreate with skipScreening=true
                      const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
                      await handleCreate(fakeEvent, true);
                    } else if (warning.action === 'propose') {
                      await handlePropose(warning.data.disbursement, true);
                    } else if (warning.action === 'execute') {
                      await handleExecute(warning.data.disbursement, true);
                    }
                  }}
                  className="w-full sm:w-auto bg-yellow-500 hover:bg-yellow-600 text-navy-900 font-medium"
                >
                  Proceed Anyway
                </Button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}

interface ScreeningBlockModalProps {
  screeningBlock: {
    flagged: Array<{ beneficiaryId: string; beneficiaryName: string; status: string }>;
    action: 'create' | 'propose' | 'execute';
  } | null;
  setScreeningBlock: (v: null) => void;
}

export function ScreeningBlockModal({
  screeningBlock,
  setScreeningBlock,
}: ScreeningBlockModalProps) {
  return (
    <>
              {screeningBlock && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setScreeningBlock(null)}>
            <div
              className="rounded-2xl border border-red-500/30 bg-navy-900 p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-red-400">
                  SDN Screening Block
                </h2>
                <button
                  onClick={() => setScreeningBlock(null)}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mb-6 space-y-3">
                <p className="text-sm text-slate-300">
                  The following beneficiary(ies) have unresolved SDN matches and cannot be processed:
                </p>
                <ul className="space-y-2">
                  {screeningBlock.flagged.map((f) => (
                    <li key={f.beneficiaryId} className="rounded-lg bg-red-500/10 border border-red-500/30 p-3">
                      <p className="text-sm font-medium text-white">{f.beneficiaryName}</p>
                      <p className="text-xs text-red-400 capitalize">{f.status.replace('_', ' ')}</p>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-slate-400">
                  An admin must review and resolve the screening results before this {screeningBlock.action === 'create' ? 'disbursement can be created' : screeningBlock.action === 'propose' ? 'transaction can be proposed' : 'transaction can be executed'}.
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setScreeningBlock(null)}
                  className="w-full sm:w-auto"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}
