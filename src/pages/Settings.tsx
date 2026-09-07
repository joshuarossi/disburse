import { useSearchParams } from 'react-router-dom';
import { Notice, PageHeader } from '@/components/workspace/WorkspacePrimitives';
import { useSettingsController } from '@/features/settings/useSettingsController';
import { OrganizationSettings } from '@/features/settings/OrganizationSettings';
import { AccountSettings } from '@/features/settings/AccountSettings';
import { FeeSettings } from '@/features/settings/FeeSettings';
import { PreferenceSettings } from '@/features/settings/PreferenceSettings';
import { ScreeningSettings } from '@/features/settings/ScreeningSettings';
import { BillingSettings } from '@/features/settings/BillingSettings';
import { BillingPaymentDialog } from '@/features/settings/BillingPaymentDialog';
const tabs = {
  general: 'General',
  safe: 'Funding accounts',
  fees: 'Payment fees',
  security: 'Screening',
  billing: 'Plan & billing',
};
export default function Settings() {
  const controller = useSettingsController();
  const [params, setParams] = useSearchParams();
  const key = params.get('tab');
  const tab = key && key in tabs ? (key as keyof typeof tabs) : 'general';
  return (
    <>
      <PageHeader
        title="Settings"
        description="Configure your workspace, funding, and payment preferences."
      />
      {controller.settingsError && <Notice>{controller.settingsError}</Notice>}
      <div className="workspace-panel mb-6">
        <div className="workspace-toolbar !border-b-0">
          <div
            className="workspace-tabs"
            role="tablist"
            aria-label="Settings sections"
          >
            {Object.entries(tabs).map(([key, label]) => (
              <button
                role="tab"
                aria-selected={tab === key}
                key={key}
                onClick={() => {
                  controller.setSettingsError('');
                  setParams({ tab: key });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="workspace-settings-sections">
        {tab === 'general' && (
          <>
            <OrganizationSettings controller={controller} />
            <PreferenceSettings controller={controller} />
          </>
        )}
        {tab === 'safe' && <AccountSettings controller={controller} />}
        {tab === 'fees' && <FeeSettings controller={controller} />}
        {tab === 'security' && <ScreeningSettings controller={controller} />}
        {tab === 'billing' && <BillingSettings controller={controller} />}
      </div>
      <BillingPaymentDialog controller={controller} />
    </>
  );
}
