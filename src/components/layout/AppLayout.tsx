import { ReactNode, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { useAccount, useDisconnect } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { api } from '../../../convex/_generated/api';
import { Id } from '../../../convex/_generated/dataModel';
import {
  LayoutDashboard,
  Users,
  Send,
  Settings,
  Building2,
  User,
  LogOut,
  Copy,
  Check,
  ChevronUp,
  Languages,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const location = useLocation();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { t } = useTranslation();
  
  // User panel state
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [copied, setCopied] = useState(false);

  const navItems = [
    { href: 'dashboard', label: t('navigation.dashboard'), icon: LayoutDashboard },
    { href: 'beneficiaries', label: t('navigation.beneficiaries'), icon: Users },
    { href: 'disbursements', label: t('navigation.disbursements'), icon: Send },
    { href: 'settings', label: t('navigation.settings'), icon: Settings },
  ];

  const org = useQuery(
    api.orgs.get,
    orgId ? { orgId: orgId as Id<'orgs'> } : 'skip'
  );

  const billing = useQuery(
    api.billing.get,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  // Get current user's membership to display their name
  const members = useQuery(
    api.orgs.listMembers,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const currentUser = members?.find(
    (m) => m?.walletAddress.toLowerCase() === address?.toLowerCase()
  );
  
  const displayName = currentUser?.name;
  const truncatedAddress = address 
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : '';

  const handleCopyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setShowUserPanel(false);
  };

  return (
    <div className="flex min-h-screen bg-navy-950">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-white/5 bg-navy-900/50">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-white/5 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-accent-400">
            <svg
              className="h-4 w-4 text-navy-950"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <span className="text-lg font-bold text-white">Disburse</span>
        </div>

        {/* Org Selector */}
        <div className="border-b border-white/5 p-4">
          <Link
            to="/select-org"
            className="flex items-center gap-3 rounded-lg bg-navy-800/50 p-3 transition-colors hover:bg-navy-800"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-700 text-slate-400">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium text-white">
                {org?.name || t('common.loading')}
              </p>
              {billing && (
                <p className="text-xs text-slate-500">
                  {billing.status === 'trial'
                    ? t('settings.billing.trialDaysLeft', { days: billing.daysRemaining })
                    : t('settings.billing.plans.pro.name') + ' ' + t('settings.billing.plans.pro.description')}
                </p>
              )}
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => {
            const href = `/org/${orgId}/${item.href}`;
            const isActive = location.pathname === href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                to={href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent-500/10 text-accent-400'
                    : 'text-slate-400 hover:bg-navy-800 hover:text-white'
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="relative border-t border-white/5 p-4">
          {/* Slide-up Panel */}
          <div
            className={cn(
              'absolute bottom-full left-0 right-0 mb-2 mx-4 rounded-xl border border-white/10 bg-navy-800 shadow-xl transition-all duration-200 ease-out',
              showUserPanel
                ? 'translate-y-0 opacity-100'
                : 'translate-y-2 opacity-0 pointer-events-none'
            )}
          >
            <div className="p-2 space-y-1">
              <div className="px-3 py-2 border-b border-white/5 mb-1">
                <p className="text-xs text-slate-500 mb-2">{t('navigation.language')}</p>
                <LanguageSwitcher variant="ghost" size="sm" />
              </div>
              <button
                onClick={handleCopyAddress}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-navy-700 hover:text-white transition-colors"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? t('common.copied') : t('common.copyAddress')}
              </button>
              <button
                onClick={handleDisconnect}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                {t('navigation.disconnect')}
              </button>
            </div>
          </div>

          {/* User Button */}
          <button
            onClick={() => setShowUserPanel(!showUserPanel)}
            className="flex w-full items-center gap-3 rounded-lg bg-navy-800/50 p-3 transition-colors hover:bg-navy-800"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-500/10 text-accent-400">
              <User className="h-4 w-4" />
            </div>
            <div className="flex-1 overflow-hidden text-left">
              {displayName ? (
                <>
                  <p className="truncate text-sm font-medium text-white">
                    {displayName}
                  </p>
                  <p className="truncate text-xs text-slate-500 font-mono">
                    {truncatedAddress}
                  </p>
                </>
              ) : (
                <p className="truncate text-sm font-medium text-white font-mono">
                  {truncatedAddress || t('common.loading')}
                </p>
              )}
            </div>
            <ChevronUp 
              className={cn(
                'h-4 w-4 text-slate-400 transition-transform',
                showUserPanel && 'rotate-180'
              )}
            />
          </button>
        </div>
      </aside>

      {/* Click outside to close panel */}
      {showUserPanel && (
        <div 
          className="fixed inset-0 z-30" 
          onClick={() => setShowUserPanel(false)}
        />
      )}

      {/* Main Content */}
      <main className="ml-64 flex-1">
        <div className="min-h-screen p-8">{children}</div>
      </main>
    </div>
  );
}
