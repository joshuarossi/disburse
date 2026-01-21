import { ReactNode } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useQuery } from 'convex/react';
import { useAccount } from 'wagmi';
import { api } from '../../../convex/_generated/api';
import { Id } from '../../../convex/_generated/dataModel';
import {
  LayoutDashboard,
  Users,
  Send,
  CreditCard,
  Settings,
  Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: ReactNode;
}

const navItems = [
  { href: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: 'beneficiaries', label: 'Beneficiaries', icon: Users },
  { href: 'disbursements', label: 'Disbursements', icon: Send },
  { href: 'billing', label: 'Billing', icon: CreditCard },
  { href: 'settings', label: 'Settings', icon: Settings },
];

export function AppLayout({ children }: AppLayoutProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const location = useLocation();
  const { address } = useAccount();

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
                {org?.name || 'Loading...'}
              </p>
              {billing && (
                <p className="text-xs text-slate-500">
                  {billing.status === 'trial'
                    ? `Trial: ${billing.daysRemaining} days left`
                    : 'Pro Plan'}
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
        <div className="border-t border-white/5 p-4">
          <ConnectButton
            accountStatus="address"
            chainStatus="icon"
            showBalance={false}
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 flex-1">
        <div className="min-h-screen p-8">{children}</div>
      </main>
    </div>
  );
}
