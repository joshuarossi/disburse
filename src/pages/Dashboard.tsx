import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount, useReadContracts } from 'wagmi';
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

// ERC20 ABI for balanceOf
const erc20Abi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export default function Dashboard() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
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
      refetchInterval: 30000, // Refresh every 30 seconds
    },
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
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="mt-1 text-slate-400">
            Overview of your treasury operations
          </p>
        </div>

        {/* Safe Card */}
        {!safe ? (
          <div className="rounded-2xl border border-dashed border-white/20 bg-navy-900/30 p-8 text-center">
            <Wallet className="mx-auto h-12 w-12 text-slate-500" />
            <h3 className="mt-4 text-lg font-medium text-white">
              No Safe Connected
            </h3>
            <p className="mt-2 text-slate-400">
              Link your Gnosis Safe to start managing disbursements
            </p>
            <Link to={`/org/${orgId}/settings`}>
              <Button className="mt-6">
                <Plus className="h-4 w-4" />
                Link Safe
              </Button>
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400">
                  <Wallet className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Connected Safe</p>
                  <p className="font-mono text-white">
                    {safe.safeAddress.slice(0, 6)}...{safe.safeAddress.slice(-4)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => refetchBalances()}
                  className="flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors"
                  title="Refresh balances"
                >
                  <RefreshCw className={`h-4 w-4 ${balancesLoading ? 'animate-spin' : ''}`} />
                </button>
                <a
                  href={`https://app.safe.global/sep:${safe.safeAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-accent-400 hover:underline"
                >
                  View on Safe
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
            </div>

            {/* Token Balances */}
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-navy-800/50 p-4">
                <p className="text-sm text-slate-400">USDC Balance</p>
                <p className="mt-1 text-2xl font-bold text-white">
                  {balancesLoading ? (
                    <span className="inline-block h-8 w-24 animate-pulse rounded bg-navy-700" />
                  ) : (
                    `$${formatBalance(usdcBalance)}`
                  )}
                </p>
              </div>
              <div className="rounded-xl bg-navy-800/50 p-4">
                <p className="text-sm text-slate-400">USDT Balance</p>
                <p className="mt-1 text-2xl font-bold text-white">
                  {balancesLoading ? (
                    <span className="inline-block h-8 w-24 animate-pulse rounded bg-navy-700" />
                  ) : (
                    `$${formatBalance(usdtBalance)}`
                  )}
                </p>
              </div>
            </div>

            {/* Deposit Address */}
            <div className="mt-6 rounded-xl border border-accent-500/20 bg-accent-500/5 p-4">
              <p className="text-sm font-medium text-accent-400">Deposit Address</p>
              <p className="mt-1 text-xs text-slate-400">
                Send USDC or USDT to this address to fund your treasury
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-navy-800 px-3 py-2 font-mono text-sm text-white break-all">
                  {safe.safeAddress}
                </code>
                <button
                  onClick={() => handleCopyAddress(safe.safeAddress)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-800 text-slate-400 transition-colors hover:bg-navy-700 hover:text-white"
                  title="Copy address"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {/* Beneficiaries */}
          <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-400">Active Beneficiaries</p>
                <p className="text-2xl font-bold text-white">
                  {beneficiaries?.length ?? '--'}
                </p>
              </div>
            </div>
            <Link to={`/org/${orgId}/beneficiaries`}>
              <Button variant="ghost" size="sm" className="mt-4 w-full">
                Manage Beneficiaries
              </Button>
            </Link>
          </div>

          {/* Pending Disbursements */}
          <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-400">Pending Disbursements</p>
                <p className="text-2xl font-bold text-white">
                  {recentDisbursements?.filter((d) => d.status === 'pending' || d.status === 'draft' || d.status === 'proposed').length ?? '--'}
                </p>
              </div>
            </div>
            <Link to={`/org/${orgId}/disbursements`}>
              <Button variant="ghost" size="sm" className="mt-4 w-full">
                View All
              </Button>
            </Link>
          </div>

          {/* Quick Action */}
          <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500/10 text-accent-400">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-400">Quick Action</p>
                <p className="text-lg font-medium text-white">New Payment</p>
              </div>
            </div>
            <Link to={`/org/${orgId}/disbursements`}>
              <Button size="sm" className="mt-4 w-full">
                <Plus className="h-4 w-4" />
                Create Disbursement
              </Button>
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
          <h2 className="text-lg font-semibold text-white">Recent Disbursements</h2>
          
          {recentDisbursements?.length === 0 ? (
            <p className="mt-4 text-center text-slate-500 py-8">
              No disbursements yet
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {recentDisbursements?.map((disbursement) => (
                <div
                  key={disbursement._id}
                  className="flex items-center justify-between rounded-lg bg-navy-800/50 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-700">
                      <Send className="h-5 w-5 text-slate-400" />
                    </div>
                    <div>
                      <p className="font-medium text-white">
                        {disbursement.beneficiary?.name || 'Unknown'}
                      </p>
                      <p className="text-sm text-slate-500">
                        {disbursement.amount} {disbursement.token}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
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
