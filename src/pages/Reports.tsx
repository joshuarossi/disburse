import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { cn } from '@/lib/utils';
import { ClipboardList, FileText, Users } from 'lucide-react';
import { TransactionsTab } from './reports/TransactionsTab';
import { SpendingTab } from './reports/SpendingTab';
import { AuditLogTab } from './reports/AuditLogTab';

type TabType = 'transactions' | 'spending' | 'audit';

export default function Reports() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('transactions');

  const tabs = [
    { id: 'transactions' as const, label: t('reports.tabs.transactions'), icon: FileText },
    { id: 'spending' as const, label: t('reports.tabs.spending'), icon: Users },
    { id: 'audit' as const, label: t('reports.tabs.audit'), icon: ClipboardList },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">{t('reports.title')}</h1>
          <p className="mt-1 text-slate-400">{t('reports.subtitle')}</p>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-white/10">
          <nav className="flex gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                    activeTab === tab.id
                      ? 'border-accent-500 text-accent-400'
                      : 'border-transparent text-slate-400 hover:text-white hover:border-white/20'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'transactions' && (
            <TransactionsTab orgId={orgId} address={address} />
          )}
          {activeTab === 'spending' && (
            <SpendingTab orgId={orgId} address={address} />
          )}
          {activeTab === 'audit' && (
            <AuditLogTab orgId={orgId} address={address} />
          )}
        </div>
      </div>
    </AppLayout>
  );
}

// ============================================================================
// Transactions Tab
// ============================================================================
