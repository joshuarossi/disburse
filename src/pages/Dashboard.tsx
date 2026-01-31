import { useState, useMemo, useEffect } from 'react';
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
  ArrowUpRight,
  Plus,
  Copy,
  Check,
} from 'lucide-react';
import { getTokensForChain, getChainName, getSafeAppUrl } from '@/lib/chains';
import { QRCodeSVG } from 'qrcode.react';

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

const CHAIN_COLORS: Record<number, string> = {
  1: '#627eea',        // Ethereum - official blue
  137: '#8247e5',      // Polygon - official purple
  8453: '#0052ff',     // Base - official blue
  42161: '#28a0f0',    // Arbitrum - official blue
  11155111: '#a78bfa', // Sepolia - lighter purple
  84532: '#0052ff',    // Base Sepolia - same as Base mainnet
};

const TOKEN_COLORS: Record<string, string> = {
  USDC: '#2775ca',
  USDT: '#26a17b',
  PYUSD: '#0042ff',
};

type ViewMode = 'byToken' | 'byChain';

export default function Dashboard() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('byToken');
  const [qrSize, setQrSize] = useState(180);

  useEffect(() => {
    const updateQrSize = () => {
      setQrSize(window.innerWidth < 640 ? 150 : 180);
    };
    updateQrSize();
    window.addEventListener('resize', updateQrSize);
    return () => window.removeEventListener('resize', updateQrSize);
  }, []);

  const handleCopyAddress = async (addr: string) => {
    await navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const safes = useQuery(
    api.safes.getForOrg,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const disbursementsList = useQuery(
    api.disbursements.list,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address, limit: 20 }
      : 'skip'
  );

  // Build contract reads: one balanceOf per (safe, token) so we get balance per chain per token
  const balanceContracts = useMemo(() => {
    if (!safes?.length) return undefined;
    const contracts: Array<{
      address: `0x${string}`;
      abi: typeof erc20Abi;
      functionName: 'balanceOf';
      args: [`0x${string}`];
      chainId: number;
      symbol: string;
      decimals: number;
    }> = [];
    for (const safe of safes) {
      const tokens = getTokensForChain(safe.chainId);
      for (const [symbol, config] of Object.entries(tokens)) {
        contracts.push({
          address: config.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [safe.safeAddress as `0x${string}`],
          chainId: safe.chainId,
          symbol,
          decimals: config.decimals,
        });
      }
    }
    return contracts.length ? contracts : undefined;
  }, [safes]);

  const { data: balanceResults, isLoading: balancesLoading, refetch: refetchBalances } = useReadContracts({
    contracts: balanceContracts,
    query: {
      enabled: !!balanceContracts?.length,
      refetchInterval: 30000,
    },
  });

  // Watch Transfer events on first safe's tokens to refetch (simplified: we refetch all on any transfer)
  const firstSafe = safes?.[0];
  const firstSafeTokens = firstSafe ? Object.values(getTokensForChain(firstSafe.chainId)) : [];
  useWatchContractEvent({
    address: firstSafeTokens[0]?.address,
    abi: erc20Abi,
    eventName: 'Transfer',
    args: firstSafe ? { to: firstSafe.safeAddress as `0x${string}` } : undefined,
    enabled: !!firstSafe && firstSafeTokens.length > 0,
    onLogs: () => refetchBalances(),
  });
  useWatchContractEvent({
    address: firstSafeTokens[0]?.address,
    abi: erc20Abi,
    eventName: 'Transfer',
    args: firstSafe ? { from: firstSafe.safeAddress as `0x${string}` } : undefined,
    enabled: !!firstSafe && firstSafeTokens.length > 0,
    onLogs: () => refetchBalances(),
  });

  // Aggregate: byChain[chainId][symbol] = balance (number), byToken[symbol][chainId] = balance
  const { byChain, byToken, totalUsd } = useMemo(() => {
    const byChain: Record<number, Record<string, number>> = {};
    const byToken: Record<string, Record<number, number>> = {};
    let totalUsd = 0;

    if (!balanceContracts || !balanceResults) return { byChain, byToken, totalUsd };

    balanceContracts.forEach((c, i) => {
      const result = balanceResults[i]?.result;
      const raw = result != null ? Number(result) : 0;
      const balance = raw / Math.pow(10, c.decimals);
      if (!byChain[c.chainId]) byChain[c.chainId] = {};
      byChain[c.chainId][c.symbol] = balance;
      if (!byToken[c.symbol]) byToken[c.symbol] = {};
      byToken[c.symbol][c.chainId] = balance;
      totalUsd += balance; // 1:1 USD for stablecoins
    });

    return { byChain, byToken, totalUsd };
  }, [balanceContracts, balanceResults]);

  const formatBalance = (balance: number) =>
    balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const depositAddress = safes?.[0]?.safeAddress;
  const pendingItems = disbursementsList?.items?.filter(
    (d) => d.status === 'draft' || d.status === 'pending' || d.status === 'proposed'
  ) ?? [];

  // Tokens/chains with at least one balance (we fetch all tokens on all chains the org has safes for)
  const tokenSymbols = useMemo(() => {
    const set = new Set<string>();
    Object.keys(byToken).forEach((s) => set.add(s));
    return Array.from(set).sort();
  }, [byToken]);

  const chainIdsWithBalances = useMemo(() => {
    const set = new Set<number>();
    Object.keys(byChain).forEach((k) => set.add(Number(k)));
    return Array.from(set).sort((a, b) => a - b);
  }, [byChain]);

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="pt-4 lg:pt-6">
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm sm:text-base text-slate-400">{t('dashboard.subtitle')}</p>
        </div>

        {!safes?.length ? (
          <div className="rounded-2xl border border-dashed border-white/20 bg-navy-900/30 p-6 sm:p-8 text-center">
            <Wallet className="mx-auto h-12 w-12 text-slate-500" />
            <h3 className="mt-4 text-lg font-medium text-white">{t('dashboard.noSafe.title')}</h3>
            <p className="mt-2 text-sm sm:text-base text-slate-400">{t('dashboard.noSafe.description')}</p>
            <Link to={`/org/${orgId}/settings`}>
              <Button className="mt-6 h-11">
                <Plus className="h-4 w-4" />
                {t('dashboard.noSafe.linkSafe')}
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {/* Unified treasury: Left = Total + Deposit | Center = QR | Right = View on Safe */}
            <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6 sm:p-8">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-8">
                {/* Left: Total Treasury + Deposit Address */}
                <div className="flex-1 min-w-0 space-y-6">
                  <div>
                    <p className="text-sm text-slate-400">{t('dashboard.totalTreasuryValue')}</p>
                    <p className="mt-2 text-3xl sm:text-4xl font-bold text-white">
                      {balancesLoading ? (
                        <span className="inline-block h-10 w-32 animate-pulse rounded bg-navy-700" />
                      ) : (
                        `$${formatBalance(totalUsd)}`
                      )}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 shrink-0">
                        <Wallet className="h-6 w-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-400">{t('dashboard.safe.depositAddress')}</p>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          <p className="font-mono text-sm sm:text-base text-white break-all">
                            {depositAddress ?? ''}
                          </p>
                          {depositAddress && (
                            <button
                              onClick={() => handleCopyAddress(depositAddress)}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-800 text-slate-400 hover:text-white transition-colors"
                              title={t('common.copyAddress')}
                            >
                              {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{t('dashboard.safe.depositDescription')}</p>
                  </div>
                </div>

                {/* Center: QR Code */}
                {depositAddress && (
                  <div className="flex justify-center lg:justify-center shrink-0">
                    <div className="rounded-lg bg-white p-3 sm:p-4">
                      <QRCodeSVG value={depositAddress} size={qrSize} level="M" />
                    </div>
                  </div>
                )}

                {/* Right: View on Safe */}
                <div className="flex justify-start lg:justify-end lg:items-start shrink-0">
                  {safes?.[0] && (
                    <a
                      href={getSafeAppUrl(safes[0].chainId, safes[0].safeAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-navy-800 px-4 py-2.5 text-sm text-accent-400 hover:bg-navy-700 transition-colors"
                    >
                      <span>{t('dashboard.safe.viewOnSafe')}</span>
                      <ArrowUpRight className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Token/chain switch — right above balances */}
            <div className="flex justify-end">
              <div className="flex rounded-xl border border-white/10 bg-navy-800/50 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('byToken')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    viewMode === 'byToken' ? 'bg-accent-500 text-navy-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t('dashboard.byToken')}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('byChain')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    viewMode === 'byChain' ? 'bg-accent-500 text-navy-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t('dashboard.byChain')}
                </button>
              </div>
            </div>

            {/* By Token / By Chain breakdown */}
            {viewMode === 'byToken' && (
              <div className="space-y-3">
                {tokenSymbols.length === 0 && totalUsd === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-navy-900/30 p-3 sm:p-4">
                    <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 mb-3">
                      <div className="flex items-baseline gap-3">
                        <p className="text-base sm:text-lg font-semibold text-slate-500">No Tokens</p>
                        <p className="text-lg sm:text-xl font-bold text-slate-600">$0.00</p>
                      </div>
                    </div>
                    <div className="h-12 sm:h-14 rounded-lg border-2 border-dashed border-white/10 bg-navy-800/50 flex items-center justify-center">
                      <p className="text-sm text-slate-500">{t('dashboard.noBalance')}</p>
                    </div>
                  </div>
                )}
                {tokenSymbols.map((symbol) => {
                  const tokenTotals = byToken[symbol];
                  if (!tokenTotals) return null;
                  const tokenTotal = Object.values(tokenTotals).reduce((a, b) => a + b, 0);
                  if (tokenTotal <= 0) return null;
                  const pct = totalUsd > 0 ? (tokenTotal / totalUsd) * 100 : 0;
                  const entries = Object.entries(tokenTotals).filter(([, v]) => v > 0);
                  return (
                    <div
                      key={symbol}
                      className="rounded-2xl border border-white/10 bg-navy-900/50 p-3 sm:p-4"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 mb-3">
                        <div className="flex items-baseline gap-3">
                          <p className="text-base sm:text-lg font-semibold text-white">{symbol}</p>
                          <p className="text-lg sm:text-xl font-bold text-accent-400">${formatBalance(tokenTotal)}</p>
                        </div>
                        <p className="text-xs text-slate-500">{pct.toFixed(1)}% {t('dashboard.ofTreasury')}</p>
                      </div>
                      <div className="flex gap-0.5 h-12 sm:h-14 rounded-lg overflow-hidden bg-navy-800">
                        {entries.map(([chainIdStr, balance]) => {
                          const chainId = Number(chainIdStr);
                          const segmentPct = tokenTotal > 0 ? (balance / tokenTotal) * 100 : 0;
                          return (
                            <div
                              key={chainId}
                              className="relative flex flex-col items-center justify-center min-w-0 transition-all hover:brightness-110 cursor-pointer group"
                              style={{
                                width: `${segmentPct}%`,
                                backgroundColor: CHAIN_COLORS[chainId] ?? '#64748b',
                              }}
                              title={`${getChainName(chainId)}: $${formatBalance(balance)}`}
                            >
                              {segmentPct > 15 && (
                                <>
                                  <span className="text-[11px] font-semibold text-white uppercase truncate max-w-full px-1">
                                    {getChainName(chainId)}
                                  </span>
                                  <span className="text-sm font-bold text-white">${formatBalance(balance)}</span>
                                </>
                              )}
                              {/* Tooltip for small segments */}
                              {segmentPct <= 15 && (
                                <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 px-2 py-1 bg-navy-950 border border-white/20 rounded text-xs text-white whitespace-nowrap">
                                  {getChainName(chainId)}: ${formatBalance(balance)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs text-slate-500">
                        {entries.map(([chainIdStr]) => {
                          const chainId = Number(chainIdStr);
                          return (
                            <div key={chainId} className="flex items-center gap-1.5">
                              <div
                                className="w-2.5 h-2.5 rounded"
                                style={{ backgroundColor: CHAIN_COLORS[chainId] ?? '#64748b' }}
                              />
                              <span>{getChainName(chainId)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {viewMode === 'byChain' && (
              <div className="space-y-3">
                {chainIdsWithBalances.length === 0 && totalUsd === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-navy-900/30 p-3 sm:p-4">
                    <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 mb-3">
                      <div className="flex items-baseline gap-3">
                        <p className="text-base sm:text-lg font-semibold text-slate-500">No Chains</p>
                        <p className="text-lg sm:text-xl font-bold text-slate-600">$0.00</p>
                      </div>
                    </div>
                    <div className="h-12 sm:h-14 rounded-lg border-2 border-dashed border-white/10 bg-navy-800/50 flex items-center justify-center">
                      <p className="text-sm text-slate-500">{t('dashboard.noBalance')}</p>
                    </div>
                  </div>
                )}
                {chainIdsWithBalances.map((chainId) => {
                  const chainTotals = byChain[chainId];
                  if (!chainTotals) return null;
                  const chainTotal = Object.values(chainTotals).reduce((a, b) => a + b, 0);
                  if (chainTotal <= 0) return null;
                  const pct = totalUsd > 0 ? (chainTotal / totalUsd) * 100 : 0;
                  const entries = Object.entries(chainTotals).filter(([, v]) => v > 0);
                  return (
                    <div
                      key={chainId}
                      className="rounded-2xl border border-white/10 bg-navy-900/50 p-3 sm:p-4"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 mb-3">
                        <div className="flex items-baseline gap-3">
                          <p className="text-base sm:text-lg font-semibold text-white">{getChainName(chainId)}</p>
                          <p
                            className="text-lg sm:text-xl font-bold"
                            style={{ color: CHAIN_COLORS[chainId] ?? '#14b8a6' }}
                          >
                            ${formatBalance(chainTotal)}
                          </p>
                        </div>
                        <p className="text-xs text-slate-500">{pct.toFixed(1)}% {t('dashboard.ofTreasury')}</p>
                      </div>
                      <div className="flex gap-0.5 h-12 sm:h-14 rounded-lg overflow-hidden bg-navy-800">
                        {entries.map(([symbol, balance]) => {
                          const segmentPct = chainTotal > 0 ? (balance / chainTotal) * 100 : 0;
                          return (
                            <div
                              key={symbol}
                              className="relative flex flex-col items-center justify-center min-w-0 transition-all hover:brightness-110 cursor-pointer group"
                              style={{
                                width: `${segmentPct}%`,
                                backgroundColor: TOKEN_COLORS[symbol] ?? '#64748b',
                              }}
                              title={`${symbol}: $${formatBalance(balance)}`}
                            >
                              {segmentPct > 15 && (
                                <>
                                  <span className="text-[11px] font-semibold text-white truncate max-w-full px-1">{symbol}</span>
                                  <span className="text-sm font-bold text-white">${formatBalance(balance)}</span>
                                </>
                              )}
                              {/* Tooltip for small segments */}
                              {segmentPct <= 15 && (
                                <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 px-2 py-1 bg-navy-950 border border-white/20 rounded text-xs text-white whitespace-nowrap">
                                  {symbol}: ${formatBalance(balance)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs text-slate-500">
                        {entries.map(([symbol]) => (
                          <div key={symbol} className="flex items-center gap-1.5">
                            <div
                              className="w-2.5 h-2.5 rounded"
                              style={{ backgroundColor: TOKEN_COLORS[symbol] ?? '#64748b' }}
                            />
                            <span>{symbol}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pending section */}
            <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-3 sm:p-4">
              <h2 className="text-sm font-semibold text-white">{t('dashboard.pending')}</h2>
              {pendingItems.length === 0 ? (
                <p className="mt-3 text-center text-sm text-slate-500 py-4">{t('dashboard.pendingNone')}</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {pendingItems.slice(0, 5).map((d) => (
                    <Link
                      key={d._id}
                      to={`/org/${orgId}/disbursements`}
                      className="flex items-center justify-between gap-3 rounded-lg bg-navy-800/50 p-2.5 sm:p-3 hover:bg-navy-800 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Send className="h-5 w-5 text-slate-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-white truncate">{d.beneficiary?.name ?? (d as any).displayAmount ?? '—'}</p>
                          <p className="text-sm text-slate-500">
                            {(d as any).displayAmount ?? d.amount} {d.token}
                            {d.chainId != null && ` · ${getChainName(d.chainId)}`}
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full px-3 py-1 text-xs font-medium bg-yellow-500/10 text-yellow-400 shrink-0">
                        {d.status}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Recent activity */}
            <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-3 sm:p-4">
              <h2 className="text-sm font-semibold text-white">{t('dashboard.recent.title')}</h2>
              {!disbursementsList?.items?.length ? (
                <p className="mt-3 text-center text-sm text-slate-500 py-5">{t('dashboard.recent.none')}</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {disbursementsList.items.slice(0, 5).map((d) => (
                    <div
                      key={d._id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg bg-navy-800/50 p-2.5 sm:p-3"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Send className="h-5 w-5 text-slate-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-white truncate">{d.beneficiary?.name ?? 'Unknown'}</p>
                          <p className="text-sm text-slate-500">
                            {(d as any).displayAmount ?? d.amount} {d.token}
                            {d.chainId != null && ` · ${getChainName(d.chainId)}`}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium shrink-0 ${
                          d.status === 'executed'
                            ? 'bg-green-500/10 text-green-400'
                            : d.status === 'failed'
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-yellow-500/10 text-yellow-400'
                        }`}
                      >
                        {d.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
