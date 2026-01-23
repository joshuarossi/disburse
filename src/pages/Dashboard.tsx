import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount, useReadContracts, useWatchContractEvent } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import {
  Wallet,
  Send,
  Users,
  Clock,
  ArrowUpRight,
  Plus,
  RefreshCw,
  Copy,
  Check,
} from 'lucide-react';
import { TOKENS } from '@/lib/wagmi';
import { formatUnits } from 'viem';

// ERC20 ABI for balanceOf and Transfer event
const erc20Abi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'Transfer',
    type: 'event',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;

export default function Dashboard() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = async (addr: string) => {
    await navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const safe = useQuery(
    api.safes.getForOrg,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const beneficiaries = useQuery(
    api.beneficiaries.list,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address, activeOnly: true }
      : 'skip'
  );

  const recentDisbursements = useQuery(
    api.disbursements.list,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address, limit: 5 }
      : 'skip'
  );

  // Fetch token balances for the Safe
  const { data: balances, isLoading: balancesLoading, refetch: refetchBalances } = useReadContracts({
    contracts: safe?.safeAddress
      ? [
          {
            address: TOKENS.USDC.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [safe.safeAddress as `0x${string}`],
          },
          {
            address: TOKENS.USDT.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [safe.safeAddress as `0x${string}`],
          },
        ]
      : undefined,
    query: {
      enabled: !!safe?.safeAddress,
      refetchInterval: 30000, // Refresh every 30 seconds as fallback
    },
  });

  // Watch for USDC transfers to/from the Safe for real-time balance updates
  useWatchContractEvent({
    address: TOKENS.USDC.address,
    abi: erc20Abi,
    eventName: 'Transfer',
    args: { to: safe?.safeAddress as `0x${string}` },
    enabled: !!safe?.safeAddress,
    onLogs: () => refetchBalances(),
  });

  useWatchContractEvent({
    address: TOKENS.USDC.address,
    abi: erc20Abi,
    eventName: 'Transfer',
    args: { from: safe?.safeAddress as `0x${string}` },
    enabled: !!safe?.safeAddress,
    onLogs: () => refetchBalances(),
  });

  // Watch for USDT transfers to/from the Safe
  useWatchContractEvent({
    address: TOKENS.USDT.address,
    abi: erc20Abi,
    eventName: 'Transfer',
    args: { to: safe?.safeAddress as `0x${string}` },
    enabled: !!safe?.safeAddress,
    onLogs: () => refetchBalances(),
  });

  useWatchContractEvent({
    address: TOKENS.USDT.address,
    abi: erc20Abi,
    eventName: 'Transfer',
    args: { from: safe?.safeAddress as `0x${string}` },
    enabled: !!safe?.safeAddress,
    onLogs: () => refetchBalances(),
  });

  // Format balances
  const usdcBalance = balances?.[0]?.result
    ? formatUnits(balances[0].result as bigint, TOKENS.USDC.decimals)
    : null;
  const usdtBalance = balances?.[1]?.result
    ? formatUnits(balances[1].result as bigint, TOKENS.USDT.decimals)
    : null;

  // Format display value with commas
  const formatBalance = (balance: string | null) => {
    if (balance === null) return '--';
    const num = parseFloat(balance);
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="pt-4 lg:pt-6">
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm sm:text-base text-slate-400">
            {t('dashboard.subtitle')}
          </p>
        </div>

        {/* Safe Card */}
        {!safe ? (
          <div className="rounded-2xl border border-dashed border-white/20 bg-navy-900/30 p-6 sm:p-8 text-center">
            <Wallet className="mx-auto h-12 w-12 text-slate-500" />
            <h3 className="mt-4 text-lg font-medium text-white">
              {t('dashboard.noSafe.title')}
            </h3>
            <p className="mt-2 text-sm sm:text-base text-slate-400">
              {t('dashboard.noSafe.description')}
            </p>
            <Link to={`/org/${orgId}/settings`}>
              <Button className="mt-6 h-11">
                <Plus className="h-4 w-4" />
                {t('dashboard.noSafe.linkSafe')}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 shrink-0">
                  <Wallet className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-slate-400">{t('dashboard.safe.connected')}</p>
                  <p className="font-mono text-sm sm:text-base text-white break-all">
                    {safe.safeAddress.slice(0, 6)}...{safe.safeAddress.slice(-4)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => refetchBalances()}
                  className="flex h-11 w-11 items-center justify-center rounded-lg bg-navy-800 text-slate-400 hover:text-white transition-colors"
                  title={t('dashboard.safe.refreshBalances')}
                >
                  <RefreshCw className={`h-5 w-5 ${balancesLoading ? 'animate-spin' : ''}`} />
                </button>
                <a
                  href={`https://app.safe.global/sep:${safe.safeAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-accent-400 hover:underline h-11 px-3"
                >
                  <span className="hidden sm:inline">{t('dashboard.safe.viewOnSafe')}</span>
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
            </div>

            {/* Token Balances */}
            <div className="mt-4 sm:mt-6 grid grid-cols-2 gap-3 sm:gap-4">
              <div className="rounded-xl bg-navy-800/50 p-3 sm:p-4">
                <p className="text-xs sm:text-sm text-slate-400">{t('dashboard.safe.usdcBalance')}</p>
                <p className="mt-1 text-xl sm:text-2xl font-bold text-white">
                  {balancesLoading ? (
                    <span className="inline-block h-6 sm:h-8 w-20 sm:w-24 animate-pulse rounded bg-navy-700" />
                  ) : (
                    `$${formatBalance(usdcBalance)}`
                  )}
                </p>
              </div>
              <div className="rounded-xl bg-navy-800/50 p-3 sm:p-4">
                <p className="text-xs sm:text-sm text-slate-400">{t('dashboard.safe.usdtBalance')}</p>
                <p className="mt-1 text-xl sm:text-2xl font-bold text-white">
                  {balancesLoading ? (
                    <span className="inline-block h-6 sm:h-8 w-20 sm:w-24 animate-pulse rounded bg-navy-700" />
                  ) : (
                    `$${formatBalance(usdtBalance)}`
                  )}
                </p>
              </div>
            </div>

            {/* Deposit Address */}
            <div className="mt-4 sm:mt-6 rounded-xl border border-accent-500/20 bg-accent-500/5 p-3 sm:p-4">
              <p className="text-xs sm:text-sm font-medium text-accent-400">{t('dashboard.safe.depositAddress')}</p>
              <p className="mt-1 text-xs text-slate-400">
                {t('dashboard.safe.depositDescription')}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-navy-800 px-2 sm:px-3 py-2 font-mono text-xs sm:text-sm text-white break-all">
                  {safe.safeAddress}
                </code>
                <button
                  onClick={() => handleCopyAddress(safe.safeAddress)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-navy-800 text-slate-400 transition-colors hover:bg-navy-700 hover:text-white"
                  title="Copy address"
                >
                  {copied ? (
                    <Check className="h-5 w-5 text-green-400" />
                  ) : (
                    <Copy className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {/* Beneficiaries */}
          <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-400">{t('dashboard.stats.activeBeneficiaries')}</p>
                <p className="text-2xl font-bold text-white">
                  {beneficiaries?.length ?? '--'}
                </p>
              </div>
            </div>
            <Link to={`/org/${orgId}/beneficiaries`}>
              <Button variant="ghost" size="sm" className="mt-4 w-full">
                {t('dashboard.stats.manageBeneficiaries')}
              </Button>
            </Link>
          </div>

          {/* Pending Disbursements */}
          <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-400">{t('dashboard.stats.pendingDisbursements')}</p>
                <p className="text-2xl font-bold text-white">
                  {recentDisbursements?.items.filter((d) => d.status === 'pending' || d.status === 'draft' || d.status === 'proposed').length ?? '--'}
                </p>
              </div>
            </div>
            <Link to={`/org/${orgId}/disbursements`}>
              <Button variant="ghost" size="sm" className="mt-4 w-full">
                {t('common.viewAll')}
              </Button>
            </Link>
          </div>

          {/* Quick Action */}
          <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500/10 text-accent-400">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-400">{t('dashboard.stats.quickAction')}</p>
                <p className="text-lg font-medium text-white">{t('dashboard.stats.newPayment')}</p>
              </div>
            </div>
            <Link to={`/org/${orgId}/disbursements`}>
              <Button size="sm" className="mt-4 w-full">
                <Plus className="h-4 w-4" />
                {t('dashboard.stats.createDisbursement')}
              </Button>
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-white">{t('dashboard.recent.title')}</h2>
          
          {recentDisbursements?.items.length === 0 ? (
            <p className="mt-4 text-center text-sm sm:text-base text-slate-500 py-8">
              {t('dashboard.recent.none')}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {recentDisbursements?.items.map((disbursement) => (
                <div
                  key={disbursement._id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg bg-navy-800/50 p-3 sm:p-4"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-700 shrink-0">
                      <Send className="h-5 w-5 text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-white truncate">
                        {disbursement.beneficiary?.name || 'Unknown'}
                      </p>
                      <p className="text-sm text-slate-500">
                        {disbursement.amount} {disbursement.token}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium shrink-0 ${
                      disbursement.status === 'executed'
                        ? 'bg-green-500/10 text-green-400'
                        : disbursement.status === 'failed'
                        ? 'bg-red-500/10 text-red-400'
                        : 'bg-yellow-500/10 text-yellow-400'
                    }`}
                  >
                    {disbursement.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
