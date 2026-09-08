import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/workspace/WorkspacePrimitives";
import { ClipboardList, FileText, Users } from "lucide-react";
import { TransactionsTab } from "./reports/TransactionsTab";
import { SpendingTab } from "./reports/SpendingTab";
import { AuditLogTab } from "./reports/AuditLogTab";
import { AccountingTab } from "./reports/AccountingTab";

type TabType = "transactions" | "spending" | "audit" | "accounting";

export default function Reports() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>("transactions");

  const tabs = [
    {
      id: "transactions" as const,
      label: t("reports.tabs.transactions"),
      icon: FileText,
    },
    { id: "spending" as const, label: t("reports.tabs.spending"), icon: Users },
    { id: "accounting" as const, label: "Reconciliation", icon: ClipboardList },
    {
      id: "audit" as const,
      label: t("reports.tabs.audit"),
      icon: ClipboardList,
    },
  ];

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title={t("reports.title")}
          description={t("reports.subtitle")}
        />

        {/* Tab Navigation */}
        <div className="border-b border-[var(--ws-border)]">
          <nav className="workspace-tabs" aria-label="Report sections">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  aria-pressed={activeTab === tab.id}
                  className="flex items-center gap-2"
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
          {activeTab === "transactions" && (
            <TransactionsTab orgId={orgId} address={address} />
          )}
          {activeTab === "spending" && (
            <SpendingTab orgId={orgId} address={address} />
          )}
          {activeTab === "audit" && (
            <AuditLogTab orgId={orgId} address={address} />
          )}
          {activeTab === "accounting" && <AccountingTab orgId={orgId} />}
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Transactions Tab
// ============================================================================
