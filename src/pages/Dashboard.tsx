import { useState, useMemo, useEffect, type ReactNode } from 'react';
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
  Calendar,
  ChevronDown,
  ChevronUp,
  Maximize2,
  X,
} from 'lucide-react';
import { ScheduledPaymentsCalendar } from '@/components/disbursements/ScheduledPaymentsCalendar';
import { getTokensForChain, getChainName, getSafeAppUrl } from '@/lib/chains';
import { QRCodeSVG } from 'qrcode.react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

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

const TESTNET_CHAIN_IDS = new Set<number>([11155111, 84532]);

type ViewMode = 'byToken' | 'byChain';

export default function Dashboard() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('byToken');
  const [hideTestnets, setHideTestnets] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('disburse.dashboard.hideTestnets') === 'true';
  });
  const [qrSize, setQrSize] = useState(180);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [showTokenBreakdown, setShowTokenBreakdown] = useState(false);
  const [activeChart, setActiveChart] = useState<'flows' | 'balance' | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('disburse.dashboard.hideTestnets', String(hideTestnets));
  }, [hideTestnets]);

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

  const scheduledDisbursements = useQuery(
    api.disbursements.list,
    orgId && address
      ? {
          orgId: orgId as Id<'orgs'>,
          walletAddress: address,
          status: ['scheduled'],
          sortBy: 'scheduledAt',
          sortOrder: 'asc',
          limit: 100,
        }
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
  const { byChain, byToken } = useMemo(() => {
    const byChain: Record<number, Record<string, number>> = {};
    const byToken: Record<string, Record<number, number>> = {};

    if (!balanceContracts || !balanceResults) return { byChain, byToken };

    balanceContracts.forEach((c, i) => {
      const result = balanceResults[i]?.result;
      const raw = result != null ? Number(result) : 0;
      const balance = raw / Math.pow(10, c.decimals);
      if (!byChain[c.chainId]) byChain[c.chainId] = {};
      byChain[c.chainId][c.symbol] = balance;
      if (!byToken[c.symbol]) byToken[c.symbol] = {};
      byToken[c.symbol][c.chainId] = balance;
    });

    return { byChain, byToken };
  }, [balanceContracts, balanceResults]);

  const chainSummaries = useMemo(() => {
    return Object.entries(byChain)
      .map(([chainIdStr, tokenTotals]) => {
        const chainId = Number(chainIdStr);
        const total = Object.values(tokenTotals).reduce((a, b) => a + b, 0);
        return { chainId, total, tokenTotals };
      })
      .filter(({ chainId, total }) => {
        if (total <= 0) return false;
        if (hideTestnets && TESTNET_CHAIN_IDS.has(chainId)) return false;
        return true;
      })
      .sort((a, b) => b.total - a.total);
  }, [byChain, hideTestnets]);

  const tokenSummaries = useMemo(() => {
    return Object.keys(byToken)
      .map((symbol) => {
        const chainTotals = byToken[symbol] ?? {};
        const entries = Object.entries(chainTotals)
          .map(([chainIdStr, balance]) => ({
            chainId: Number(chainIdStr),
            balance,
          }))
          .filter(({ chainId, balance }) => {
            if (balance <= 0) return false;
            if (hideTestnets && TESTNET_CHAIN_IDS.has(chainId)) return false;
            return true;
          })
          .sort((a, b) => b.balance - a.balance);
        const total = entries.reduce((sum, entry) => sum + entry.balance, 0);
        return { symbol, total, entries };
      })
      .filter((item) => item.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [byToken, hideTestnets]);

  const visibleTotalUsd = useMemo(
    () => chainSummaries.reduce((sum, item) => sum + item.total, 0),
    [chainSummaries]
  );

  const formatBalance = (balance: number) =>
    balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const thisMonthScheduled = useMemo(() => {
    const items = scheduledDisbursements?.items ?? [];
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    type ScheduledItem = { scheduledAt?: number };
    return items.filter((item) => {
      const scheduledAt = (item as ScheduledItem).scheduledAt;
      if (!scheduledAt) return false;
      const d = new Date(scheduledAt);
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }, [scheduledDisbursements]);

  type DisplayItem = { displayAmount?: string; amount?: string };
  const monthlyTotal = useMemo(() => {
    return thisMonthScheduled.reduce((sum, item) => {
      return sum + parseFloat((item as DisplayItem).displayAmount ?? (item as DisplayItem).amount ?? '0');
    }, 0);
  }, [thisMonthScheduled]);

  const tokenBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of thisMonthScheduled) {
      const token = item.token;
      const amount = parseFloat((item as DisplayItem).displayAmount ?? (item as DisplayItem).amount ?? '0');
      map.set(token, (map.get(token) ?? 0) + amount);
    }
    return Array.from(map.entries())
      .map(([token, total]) => ({ token, total }))
      .sort((a, b) => b.total - a.total);
  }, [thisMonthScheduled]);

  const chartRange = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }, []);

  const chartDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(chartRange.start);
      d.setDate(chartRange.start.getDate() + i);
      days.push(d);
    }
    return days;
  }, [chartRange]);

  const chartReport = useQuery(
    api.reports.getTransactionReport,
    orgId && address
      ? {
          orgId: orgId as Id<'orgs'>,
          walletAddress: address,
          startDate: chartRange.start.getTime(),
          endDate: chartRange.end.getTime(),
          status: ['executed', 'received'],
        }
      : 'skip'
  );

  const chartLoading = chartReport === undefined;
  const balanceLoading = balancesLoading || chartLoading;

  const inflowOutflowData = useMemo(() => {
    const outflowByDay = new Map<string, number>();
    const inflowByDay = new Map<string, number>();

    const items = chartReport?.items ?? [];
    for (const item of items) {
      if (hideTestnets && item.chainId != null && TESTNET_CHAIN_IDS.has(item.chainId)) {
        continue;
      }
      const key = new Date(item.createdAt).toLocaleDateString('en-CA');
      const amount = parseFloat(item.amount ?? '0');
      if (!Number.isFinite(amount)) continue;
      if (item.direction === 'inflow') {
        inflowByDay.set(key, (inflowByDay.get(key) ?? 0) + amount);
      } else {
        outflowByDay.set(key, (outflowByDay.get(key) ?? 0) + amount);
      }
    }

    return chartDays.map((day) => {
      const key = day.toLocaleDateString('en-CA');
      return {
        key,
        label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        inflow: inflowByDay.get(key) ?? 0,
        outflow: outflowByDay.get(key) ?? 0,
      };
    });
  }, [chartReport, chartDays, hideTestnets]);

  const chartTotals = useMemo(() => {
    return inflowOutflowData.reduce(
      (acc, day) => {
        acc.inflow += day.inflow;
        acc.outflow += day.outflow;
        return acc;
      },
      { inflow: 0, outflow: 0 }
    );
  }, [inflowOutflowData]);

  const balanceTrend = useMemo(() => {
    const startingBalance = visibleTotalUsd - (chartTotals.inflow - chartTotals.outflow);
    let running = startingBalance;
    return inflowOutflowData.map((day) => {
      running += day.inflow - day.outflow;
      return Math.max(running, 0);
    });
  }, [chartTotals.inflow, chartTotals.outflow, inflowOutflowData, visibleTotalUsd]);

  const compactCurrency = useMemo(
    () => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }),
    []
  );
  const formatCompactCurrency = (value: number) => {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    return `${sign}$${compactCurrency.format(abs)}`;
  };
  const formatTooltipCurrency = (value: number) => {
    const abs = Math.abs(value);
    const formatted = abs.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return `${value < 0 ? '-' : ''}$${formatted}`;
  };
  const formatPositiveCurrency = (value: number) => {
    const abs = Math.abs(value);
    return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  const renderTooltip = (title: string, rows: Array<{ label: string; value: string; color: string }>) => {
    const rowsHtml = rows
      .map(
        (row) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:6px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${row.color};"></span>
              <span style="font-size:12px;color:#e2e8f0;">${row.label}</span>
            </div>
            <span style="font-size:12px;font-weight:600;color:#f8fafc;">${row.value}</span>
          </div>
        `
      )
      .join('');
    return `
      <div style="padding:10px 12px;background:#0b1220;border:1px solid rgba(148,163,184,0.25);border-radius:12px;color:#e2e8f0;min-width:160px;box-shadow:0 10px 30px rgba(2,6,23,0.45);">
        <div style="font-size:12px;color:#94a3b8;">${title}</div>
        ${rowsHtml}
      </div>
    `;
  };

  const inflowOutflowCategories = useMemo(
    () => inflowOutflowData.map((day) => day.label),
    [inflowOutflowData]
  );

  const inflowOutflowSeries = useMemo(
    () => [
      { name: t('dashboard.charts.inflows', { defaultValue: 'Inflows' }), data: inflowOutflowData.map((d) => d.inflow) },
      { name: t('dashboard.charts.outflows', { defaultValue: 'Outflows' }), data: inflowOutflowData.map((d) => -d.outflow) },
    ],
    [inflowOutflowData, t]
  );

  const balanceSeries = useMemo(
    () => [{ name: t('dashboard.charts.balance', { defaultValue: 'Balance' }), data: balanceTrend }],
    [balanceTrend, t]
  );

  const balanceBounds = useMemo(() => {
    if (!balanceTrend.length) return { min: undefined, max: undefined };
    let min = Math.min(...balanceTrend);
    let max = Math.max(...balanceTrend);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: undefined, max: undefined };
    }
    if (min === max) {
      const pad = min === 0 ? 1 : min * 0.02;
      min = Math.max(0, min - pad);
      max = max + pad;
    } else {
      const pad = (max - min) * 0.08;
      min = Math.max(0, min - pad);
      max = max + pad;
    }
    return { min, max };
  }, [balanceTrend]);

  const inflowOutflowOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: 'bar',
        toolbar: { show: false },
        foreColor: '#94a3b8',
        fontFamily: 'inherit',
      },
      plotOptions: {
        bar: {
          columnWidth: '55%',
          borderRadius: 6,
        },
      },
      dataLabels: { enabled: false },
      stroke: { width: 0 },
      grid: { borderColor: 'rgba(148, 163, 184, 0.15)' },
      colors: ['#2dd4bf', '#f97316'],
      xaxis: {
        categories: inflowOutflowCategories,
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          formatter: (value) => formatCompactCurrency(value),
        },
      },
      tooltip: {
        shared: true,
        intersect: false,
        custom: ({ series, dataPointIndex }) => {
          if (dataPointIndex == null || dataPointIndex < 0) return '';
          const label = inflowOutflowCategories[dataPointIndex] ?? '';
          const inflowValue = series?.[0]?.[dataPointIndex] ?? 0;
          const outflowValue = series?.[1]?.[dataPointIndex] ?? 0;
          return renderTooltip(label, [
            { label: t('dashboard.charts.inflows', { defaultValue: 'Inflows' }), value: formatPositiveCurrency(inflowValue), color: '#2dd4bf' },
            { label: t('dashboard.charts.outflows', { defaultValue: 'Outflows' }), value: formatPositiveCurrency(outflowValue), color: '#f97316' },
          ]);
        },
      },
      legend: { show: false },
    }),
    [formatCompactCurrency, formatPositiveCurrency, inflowOutflowCategories, renderTooltip, t]
  );

  const balanceOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: 'line',
        toolbar: { show: false },
        foreColor: '#94a3b8',
        fontFamily: 'inherit',
        dropShadow: {
          enabled: true,
          top: 2,
          left: 0,
          blur: 4,
          opacity: 0.35,
          color: '#38bdf8',
        },
      },
      stroke: { curve: 'smooth', width: 3 },
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.28,
          opacityTo: 0.02,
          stops: [0, 90, 100],
        },
      },
      dataLabels: { enabled: false },
      grid: { borderColor: 'rgba(148, 163, 184, 0.2)', strokeDashArray: 3 },
      colors: ['#38bdf8'],
      xaxis: {
        categories: inflowOutflowCategories,
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: { style: { colors: '#94a3b8', fontSize: '12px' } },
      },
      yaxis: {
        min: balanceBounds.min,
        max: balanceBounds.max,
        tickAmount: 4,
        labels: {
          formatter: (value) => formatCompactCurrency(value),
        },
      },
      markers: {
        size: 4,
        strokeWidth: 2,
        strokeColors: '#0f172a',
        hover: { size: 6 },
      },
      tooltip: {
        shared: false,
        intersect: false,
        custom: ({ series, dataPointIndex }) => {
          if (dataPointIndex == null || dataPointIndex < 0) return '';
          const label = inflowOutflowCategories[dataPointIndex] ?? '';
          const value = series?.[0]?.[dataPointIndex];
          if (value == null) return '';
          return renderTooltip(label, [
            {
              label: t('dashboard.charts.balance', { defaultValue: 'Balance' }),
              value: formatTooltipCurrency(value),
              color: '#38bdf8',
            },
          ]);
        },
      },
      legend: { show: false },
      }),
    [balanceBounds.max, balanceBounds.min, formatCompactCurrency, formatTooltipCurrency, inflowOutflowCategories, renderTooltip, t]
  );

  const depositAddress = safes?.[0]?.safeAddress;
  const pendingItems = disbursementsList?.items?.filter(
    (d) => d.status === 'draft' || d.status === 'pending' || d.status === 'proposed'
  ) ?? [];
  const executedItems = disbursementsList?.items?.filter((d) => d.status === 'executed') ?? [];
  const availabilityLoading = balancesLoading || scheduledDisbursements === undefined || disbursementsList === undefined;

  const pendingTotal = useMemo(() => {
    return pendingItems.reduce((sum, item) => {
      if (hideTestnets && item.chainId != null && TESTNET_CHAIN_IDS.has(item.chainId)) {
        return sum;
      }
      const amount = parseFloat((item as DisplayItem).displayAmount ?? item.amount ?? '0');
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);
  }, [hideTestnets, pendingItems]);

  const scheduledTotal = useMemo(() => {
    const items = scheduledDisbursements?.items ?? [];
    return items.reduce((sum, item) => {
      if (hideTestnets && item.chainId != null && TESTNET_CHAIN_IDS.has(item.chainId)) {
        return sum;
      }
      const amount = parseFloat((item as DisplayItem).displayAmount ?? item.amount ?? '0');
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);
  }, [hideTestnets, scheduledDisbursements]);

  const availableTotal = visibleTotalUsd - (pendingTotal + scheduledTotal);
  const availableRounded = Math.round(availableTotal);
  const availableIsNegative = availableTotal < 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="pt-2 lg:pt-4">
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('dashboard.title')}</h1>
          <p className="mt-0.5 text-sm sm:text-base text-slate-400">{t('dashboard.subtitle')}</p>
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
            {/* Hero card */}
            <div className="rounded-2xl border border-white/10 bg-navy-900/50">
              <div className="p-6 sm:p-8">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-8">
                  {/* Left: Total Treasury + Deposit Address */}
                  <div className="flex-1 min-w-0 space-y-6">
                    <div>
                      <p className="text-sm text-slate-400">{t('dashboard.totalTreasuryValue')}</p>
                      <p className="mt-2 text-3xl sm:text-4xl font-bold text-white">
                        {balancesLoading ? (
                          <span className="inline-block h-10 w-32 animate-pulse rounded bg-navy-700" />
                        ) : (
                          `$${formatBalance(visibleTotalUsd)}`
                        )}
                      </p>
                      <p
                        className={`mt-2 text-xs sm:text-sm font-medium ${
                          availableIsNegative ? 'text-rose-400' : 'text-slate-400'
                        }`}
                      >
                        (
                        {availabilityLoading
                          ? '—'
                          : `~$${availableRounded.toLocaleString()} ${t('dashboard.available', { defaultValue: 'available' })}`
                        }
                        )
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
            </div>

            {/* Breakdown + charts */}
            <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
              <div className="rounded-2xl border border-white/10 bg-navy-900/50 px-4 sm:px-6 pt-3 pb-4 sm:pb-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                  <button
                    type="button"
                    onClick={() => setHideTestnets((prev) => !prev)}
                    className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white"
                  >
                    <span
                      className={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
                        hideTestnets ? 'border-accent-500/60 bg-accent-500/20' : 'border-white/10 bg-navy-800'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                          hideTestnets ? 'translate-x-4 bg-accent-400' : 'translate-x-1 bg-slate-500'
                        }`}
                      />
                    </span>
                    <span className="font-medium text-slate-300">
                      {t('dashboard.hideTestnets', { defaultValue: 'Hide testnets' })}
                    </span>
                  </button>

                  <div className="flex rounded-lg border border-white/10 bg-navy-800/50 p-1">
                    <button
                      type="button"
                      onClick={() => setViewMode('byToken')}
                      className={`py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${
                        viewMode === 'byToken' ? 'bg-accent-500 text-navy-950' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {t('dashboard.byToken')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('byChain')}
                      className={`py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${
                        viewMode === 'byChain' ? 'bg-accent-500 text-navy-950' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {t('dashboard.byChain')}
                    </button>
                  </div>
                </div>

                {/* By Token / By Chain breakdown */}
                {viewMode === 'byToken' && (
                  <div className="space-y-2">
                    {tokenSummaries.length === 0 && visibleTotalUsd === 0 && (
                      <div className="rounded-xl border border-dashed border-white/10 bg-navy-900/30 p-2.5 sm:p-3">
                        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1.5 mb-2">
                          <div className="flex items-baseline gap-2">
                            <p className="text-sm font-semibold text-slate-500">No Tokens</p>
                            <p className="text-base font-bold text-slate-600">$0.00</p>
                          </div>
                        </div>
                        <div className="h-8 sm:h-9 rounded-lg border-2 border-dashed border-white/10 bg-navy-800/50 flex items-center justify-center">
                          <p className="text-xs text-slate-500">{t('dashboard.noBalance')}</p>
                        </div>
                      </div>
                    )}
                    {tokenSummaries.map(({ symbol, total: tokenTotal, entries }) => {
                      const pct = visibleTotalUsd > 0 ? (tokenTotal / visibleTotalUsd) * 100 : 0;
                      return (
                        <div
                          key={symbol}
                          className="rounded-xl border border-white/10 bg-navy-900/50 p-2.5 sm:p-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1.5 mb-2">
                            <div className="flex items-baseline gap-2">
                              <p className="text-sm font-semibold text-white">{symbol}</p>
                              <p className="text-base font-bold text-accent-400">${formatBalance(tokenTotal)}</p>
                            </div>
                            <p className="text-xs text-slate-500">{pct.toFixed(1)}% {t('dashboard.ofTreasury')}</p>
                          </div>
                          <div className="flex gap-0.5 h-8 sm:h-9 rounded-lg overflow-hidden bg-navy-800">
                            {entries.map(({ chainId, balance }) => {
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
                                      <span className="text-[10px] font-semibold text-white uppercase truncate max-w-full px-0.5">
                                        {getChainName(chainId)}
                                      </span>
                                      <span className="text-xs font-bold text-white">${formatBalance(balance)}</span>
                                    </>
                                  )}
                                  {segmentPct <= 15 && (
                                    <div className="absolute bottom-full mb-1.5 hidden group-hover:block z-10 px-2 py-1 bg-navy-950 border border-white/20 rounded text-xs text-white whitespace-nowrap">
                                      {getChainName(chainId)}: ${formatBalance(balance)}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-1.5 text-xs text-slate-500">
                            {entries.map(({ chainId }) => {
                              return (
                                <div key={chainId} className="flex items-center gap-1">
                                  <div
                                    className="w-2 h-2 rounded"
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
                  <div className="space-y-2">
                    {chainSummaries.length === 0 && visibleTotalUsd === 0 && (
                      <div className="rounded-xl border border-dashed border-white/10 bg-navy-900/30 p-2.5 sm:p-3">
                        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1.5 mb-2">
                          <div className="flex items-baseline gap-2">
                            <p className="text-sm font-semibold text-slate-500">No Chains</p>
                            <p className="text-base font-bold text-slate-600">$0.00</p>
                          </div>
                        </div>
                        <div className="h-8 sm:h-9 rounded-lg border-2 border-dashed border-white/10 bg-navy-800/50 flex items-center justify-center">
                          <p className="text-xs text-slate-500">{t('dashboard.noBalance')}</p>
                        </div>
                      </div>
                    )}
                    {chainSummaries.map(({ chainId, total: chainTotal, tokenTotals }) => {
                      const pct = visibleTotalUsd > 0 ? (chainTotal / visibleTotalUsd) * 100 : 0;
                      const entries = Object.entries(tokenTotals)
                        .filter(([, v]) => v > 0)
                        .sort(([, a], [, b]) => b - a);
                      return (
                        <div
                          key={chainId}
                          className="rounded-xl border border-white/10 bg-navy-900/50 p-2.5 sm:p-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1.5 mb-2">
                            <div className="flex items-baseline gap-2">
                              <p className="text-sm font-semibold text-white">{getChainName(chainId)}</p>
                              <p
                                className="text-base font-bold"
                                style={{ color: CHAIN_COLORS[chainId] ?? '#14b8a6' }}
                              >
                                ${formatBalance(chainTotal)}
                              </p>
                            </div>
                            <p className="text-xs text-slate-500">{pct.toFixed(1)}% {t('dashboard.ofTreasury')}</p>
                          </div>
                          <div className="flex gap-0.5 h-8 sm:h-9 rounded-lg overflow-hidden bg-navy-800">
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
                                      <span className="text-[10px] font-semibold text-white truncate max-w-full px-0.5">{symbol}</span>
                                      <span className="text-xs font-bold text-white">${formatBalance(balance)}</span>
                                    </>
                                  )}
                                  {segmentPct <= 15 && (
                                    <div className="absolute bottom-full mb-1.5 hidden group-hover:block z-10 px-2 py-1 bg-navy-950 border border-white/20 rounded text-xs text-white whitespace-nowrap">
                                      {symbol}: ${formatBalance(balance)}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-1.5 text-xs text-slate-500">
                            {entries.map(([symbol]) => (
                              <div key={symbol} className="flex items-center gap-1">
                                <div
                                  className="w-2 h-2 rounded"
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
              </div>

              <div className="space-y-4">
                <ChartCard
                  title={t('dashboard.charts.inflowsOutflows', { defaultValue: 'Inflows & Outflows' })}
                  subtitle={t('dashboard.charts.last7Days', { defaultValue: 'Last 7 days' })}
                  onExpand={() => setActiveChart('flows')}
                  footnote={
                    chartTotals.inflow === 0 && chartTotals.outflow === 0
                      ? t('dashboard.charts.noActivity', { defaultValue: 'No executed disbursements in the last 7 days.' })
                      : t('dashboard.charts.executedOnly', { defaultValue: 'Based on executed disbursements and received deposits.' })
                  }
                >
                  {chartLoading ? (
                    <div className="h-40 rounded-xl bg-navy-800/60 animate-pulse" />
                  ) : (
                    <Chart options={inflowOutflowOptions} series={inflowOutflowSeries} type="bar" height={180} />
                  )}
                </ChartCard>

                <ChartCard
                  title={t('dashboard.charts.balanceOverTime', { defaultValue: 'Balance Over Time' })}
                  subtitle={t('dashboard.charts.last7Days', { defaultValue: 'Last 7 days' })}
                  onExpand={() => setActiveChart('balance')}
                  footnote={t('dashboard.charts.estimatedBalance', { defaultValue: 'Estimated from executed disbursements.' })}
                >
                  {balanceLoading ? (
                    <div className="h-40 rounded-xl bg-navy-800/60 animate-pulse" />
                  ) : (
                    <Chart options={balanceOptions} series={balanceSeries} type="line" height={180} />
                  )}
                </ChartCard>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                      to={`/org/${orgId}/disbursements?focus=${d._id}`}
                      className="flex items-center justify-between gap-3 rounded-lg bg-navy-800/50 p-2.5 sm:p-3 hover:bg-navy-800 transition-colors"
                    >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Send className="h-5 w-5 text-slate-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-white truncate">{d.beneficiary?.name ?? (d as DisplayItem).displayAmount ?? '—'}</p>
                            <p className="text-sm text-slate-500">
                              {(d as DisplayItem).displayAmount ?? d.amount} {d.token}
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

              {/* Scheduled Payments section */}
              <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-3 sm:p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">{t('dashboard.scheduled.title')}</h2>
                  <button
                    onClick={() => setShowCalendarModal(true)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-navy-800 transition-colors"
                    title={t('dashboard.scheduled.openCalendar')}
                  >
                    <Calendar className="h-4 w-4" />
                  </button>
                </div>

                {thisMonthScheduled.length === 0 ? (
                  <p className="mt-3 text-center text-sm text-slate-500 py-4">{t('dashboard.scheduled.none')}</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    <p className="text-2xl font-bold text-white">${formatBalance(monthlyTotal)}</p>

                    <button
                      type="button"
                      onClick={() => setShowTokenBreakdown((prev) => !prev)}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-300 transition-colors"
                    >
                      {showTokenBreakdown ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      <span>
                        {tokenBreakdown.map((tb) => `${tb.total.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${tb.token}`).join(' · ')}
                      </span>
                    </button>

                    {showTokenBreakdown && (
                      <div className="space-y-1.5 pl-4">
                        {tokenBreakdown.map((tb) => (
                          <div key={tb.token} className="flex items-baseline justify-between">
                            <span className="text-xs text-slate-300 font-medium">{tb.token}</span>
                            <span className="text-xs font-mono text-accent-400">${formatBalance(tb.total)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <p className="text-xs text-slate-500">
                      {t(thisMonthScheduled.length === 1 ? 'dashboard.scheduled.count' : 'dashboard.scheduled.countPlural', { count: thisMonthScheduled.length })}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Recent activity */}
            <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-3 sm:p-4">
              <h2 className="text-sm font-semibold text-white">{t('dashboard.recent.title')}</h2>
              {executedItems.length === 0 ? (
                <p className="mt-3 text-center text-sm text-slate-500 py-5">{t('dashboard.recent.none')}</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {executedItems.slice(0, 5).map((d) => (
                    <div
                      key={d._id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg bg-navy-800/50 p-2.5 sm:p-3"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Send className="h-5 w-5 text-slate-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-white truncate">{d.beneficiary?.name ?? 'Unknown'}</p>
                          <p className="text-sm text-slate-500">
                            {(d as DisplayItem).displayAmount ?? d.amount} {d.token}
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

      {/* Scheduled Payments Calendar Modal */}
      {showCalendarModal && (
        <ScheduledPaymentsCalendar
          payments={scheduledDisbursements?.items ?? []}
          onClose={() => setShowCalendarModal(false)}
        />
      )}

      {activeChart === 'flows' && (
        <ChartModal
          title={t('dashboard.charts.inflowsOutflows', { defaultValue: 'Inflows & Outflows' })}
          subtitle={t('dashboard.charts.last7Days', { defaultValue: 'Last 7 days' })}
          onClose={() => setActiveChart(null)}
        >
          {chartLoading ? (
            <div className="h-72 rounded-xl bg-navy-800/60 animate-pulse" />
          ) : (
            <Chart options={inflowOutflowOptions} series={inflowOutflowSeries} type="bar" height={320} />
          )}
        </ChartModal>
      )}

      {activeChart === 'balance' && (
        <ChartModal
          title={t('dashboard.charts.balanceOverTime', { defaultValue: 'Balance Over Time' })}
          subtitle={t('dashboard.charts.last7Days', { defaultValue: 'Last 7 days' })}
          onClose={() => setActiveChart(null)}
        >
          {balanceLoading ? (
            <div className="h-72 rounded-xl bg-navy-800/60 animate-pulse" />
          ) : (
            <Chart options={balanceOptions} series={balanceSeries} type="line" height={320} />
          )}
        </ChartModal>
      )}
    </AppLayout>
  );
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  onExpand: () => void;
  children: ReactNode;
  footnote?: string;
}

function ChartCard({ title, subtitle, onExpand, children, footnote }: ChartCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onExpand();
        }
      }}
      className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onExpand();
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-navy-800 transition-colors"
          title="Expand chart"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3">{children}</div>
      {footnote && <p className="mt-2 text-xs text-slate-500">{footnote}</p>}
    </div>
  );
}

interface ChartModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

function ChartModal({ title, subtitle, onClose, children }: ChartModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="rounded-2xl border border-white/10 bg-navy-900 p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-navy-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
