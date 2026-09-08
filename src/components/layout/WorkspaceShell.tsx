import {
  ActivitySelector,
  useActivityEnvironment,
} from "@/features/workspace/ActivityEnvironment";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowUpRight,
  Building2,
  ChevronDown,
  FileBarChart,
  HelpCircle,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Receipt,
  Repeat2,
  Settings2,
  Users,
  UsersRound,
  Wallet,
  X,
  Plus,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Dialog } from "@/components/ui/Dialog";
import { ThemeSwitcher } from "@/components/ui/ThemeSwitcher";
import { PaymentReminders, ReminderBoundary } from '@/features/payments/PaymentReminders';
import type { Id } from '../../../convex/_generated/dataModel';

const workspaceNavigation = [
  {
    path: "dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    section: "Workspace",
  },
  {
    path: "disbursements",
    label: "Payments",
    icon: ListChecks,
    section: "Workspace",
  },
  {
    path: "beneficiaries",
    label: "Recipients",
    icon: Users,
    section: "Workspace",
  },
  { path: "invoices", label: "Bills", icon: Receipt, section: "Workspace" },
  {
    path: "receivables",
    label: "Invoices",
    icon: Receipt,
    section: "Workspace",
  },
  {
    path: "payments",
    label: "Schedules",
    icon: Repeat2,
    section: "Workspace",
  },
  { path: "treasury", label: "Accounts", icon: Wallet, section: "Manage" },
  { path: "reports", label: "Reports", icon: FileBarChart, section: "Manage" },
  {
    path: "team",
    label: "Team & approvals",
    icon: UsersRound,
    section: "Manage",
  },
  { path: "settings", label: "Settings", icon: Settings2, section: "Manage" },
];

export function WorkspaceShell({
  children,
  orgId,
  orgName,
  userName,
  role,
  onSignOut,
}: {
  children: ReactNode;
  orgId: string;
  orgName: string;
  userName: string;
  role?: string;
  onSignOut?: () => void;
}) {
  const location = useLocation();
  const { environment } = useActivityEnvironment();
  const { theme, setTheme } = useTheme();
  const [mobile, setMobile] = useState(false);
  const [profile, setProfile] = useState(false);
  useEffect(() => {
    setMobile(false);
  }, [location.pathname]);
  const prefix = `/org/${orgId}`;
  const current = workspaceNavigation.find((n) =>
    location.pathname.endsWith(`/${n.path}`),
  );
  const navigation = (
    <>
      <Link
        to={`${prefix}/dashboard`}
        className="workspace-brand"
        aria-label="Disburse overview"
      >
        <span className="workspace-brand-mark">
          d<span>.</span>
        </span>
        <span>disburse</span>
      </Link>
      <Link to="/select-org" className="workspace-org">
        <span className="workspace-org-icon">
          <Building2 size={18} />
        </span>
        <span>
          <strong>{orgName}</strong>
          <small>Business workspace</small>
        </span>
        <ChevronDown size={14} />
      </Link>
      <nav aria-label="Main navigation" className="workspace-nav">
        {["Workspace", "Manage"].map((section) => (
          <div key={section}>
            <p>{section}</p>
            {workspaceNavigation
              .filter((n) => n.section === section)
              .map(({ path, label, icon: Icon }) => (
                <Link
                  key={path}
                  to={`${prefix}/${path}`}
                  aria-current={
                    location.pathname.endsWith(`/${path}`) ? "page" : undefined
                  }
                >
                  <Icon size={18} strokeWidth={1.7} />
                  <span>{label}</span>
                </Link>
              ))}
          </div>
        ))}
      </nav>
      <div className="workspace-sidebar-bottom">
        <Link to="/docs" className="workspace-help">
          <HelpCircle size={17} />
          Help & documentation
          <ArrowUpRight size={14} />
        </Link>
        <button className="workspace-profile" onClick={() => setProfile(true)}>
          <span className="workspace-avatar">
            {userName.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{userName}</strong>
            <small>
              {role ? role[0].toUpperCase() + role.slice(1) : "Team member"}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
      </div>
    </>
  );
  return (
    <div className="workspace">
      <a className="workspace-skip" href="#workspace-content">
        Skip to content
      </a>
      <aside className="workspace-sidebar">{navigation}</aside>
      <div className="workspace-body">
        <div className="workspace-topbar">
          <div className="flex items-center gap-3">
            <button
              className="workspace-menu-button"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span className="workspace-breadcrumb">
              {orgName}
              <span>/</span>
              <strong>{current?.label ?? "Workspace"}</strong>
            </span>
          </div>
          <div className="workspace-topbar-actions flex items-center gap-3">
            <ActivitySelector />
            <ReminderBoundary key={orgId}><PaymentReminders orgId={orgId as Id<'orgs'>} /></ReminderBoundary>
            {import.meta.env.MODE === "qa" && (
              <span className="workspace-preview-label">
                Preview · sample data · read-only
              </span>
            )}
            <button
              className="workspace-button"
              aria-label={
                theme === "light"
                  ? "Switch to dark theme"
                  : "Switch to light theme"
              }
              title="Change appearance"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            {role &&
              ["admin", "approver", "initiator"].includes(role) &&
              !["dashboard", "disbursements", "payments"].includes(
                current?.path ?? "",
              ) && (
                <Link
                  className="workspace-button workspace-button-primary"
                  aria-label="New payment"
                  title="New payment"
                  to={`${prefix}/disbursements?new=1`}
                >
                  <Plus size={15} />
                  <span className="workspace-topbar-action-label">New payment</span>
                </Link>
              )}
          </div>
        </div>
        <main
          id="workspace-content"
          tabIndex={-1}
          className="workspace-content"
        >
          {environment !== "production" && (
            <div className="workspace-environment-notice" role="status">
              <strong>
                {environment === "test"
                  ? "Test activity"
                  : "Unclassified records"}
              </strong>
              <span>
                {environment === "test"
                  ? "Test payments and balances are separate from business funds."
                  : "These records need reconciliation and are excluded from business totals."}{" "}
                Recipients, bills and team settings are shared.
              </span>
            </div>
          )}
          <div key={environment}>{children}</div>
        </main>
        <footer className="workspace-footer">
          <span>Disburse</span>
          <span>Payments your team can account for.</span>
        </footer>
      </div>
      {mobile && (
        <Dialog title="Workspace navigation" onClose={() => setMobile(false)}>
          <div className="workspace-mobile-nav">
            <button className="sr-only" onClick={() => setMobile(false)}>
              <X />
              Close
            </button>
            {navigation}
          </div>
        </Dialog>
      )}
      {profile && (
        <Dialog title="Your preferences" onClose={() => setProfile(false)}>
          <div className="space-y-6 p-6">
            <div>
              <p className="finance-label">Appearance</p>
              <ThemeSwitcher />
            </div>
            <div>
              <p className="finance-label">Language</p>
              <p className="text-sm text-[var(--ws-muted)]">English</p>
            </div>
            {onSignOut && (
              <button className="workspace-button" onClick={onSignOut}>
                <LogOut size={16} />
                Sign out
              </button>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
