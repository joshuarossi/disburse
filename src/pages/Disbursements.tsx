import { useState, useMemo, useRef, useEffect } from 'react';
import { getSessionToken } from '@/lib/session';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAccount, useReadContracts, useChainId } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { convex } from '@/lib/convex';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { BatchDetailModal } from '@/components/disbursements/BatchDetailModal';
import { DisbursementsList } from '@/components/disbursements/DisbursementsList';
import { DisbursementsFilterBar } from '@/components/disbursements/DisbursementsFilterBar';
import { CreateDisbursementForm } from '@/components/disbursements/CreateDisbursementForm';
import {
  CancelConfirmModal,
  RescheduleModal,
  ScreeningWarningModal,
  ScreeningBlockModal,
  type ScreeningWarningState,
} from '@/components/disbursements/DisbursementModals';
import {
  Plus, ArrowUpRight, Loader2, Play, CheckCircle, X, Rocket,
  Calendar, RefreshCw
} from 'lucide-react';
import {
  createTransferTx,
  createBatchTransferTxs,
  proposeTransaction,
  executeTransaction,
} from '@/lib/safe';
import { executeTransactionViaGelato, proposeTransactionViaGelato } from '@/lib/safeRelay';
import { selectRelayFeeToken } from '@/lib/relayFee';
import { RELAY_FEATURE_ENABLED, resolveRelaySettings, type RelayFeeMode } from '@/lib/relayConfig';
import {
  CHAINS_LIST,
  getTokenSymbolsForChain,
  getTokensForChain,
  getBlockExplorerTxUrl,
} from '@/lib/chains';
import { useSwitchChain } from 'wagmi';

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

const PAGE_SIZE = 10;
const normalizeTag = (tag: string) => tag.trim().toLowerCase();
const toLocalDateTimeInputValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};
const MIN_SCHEDULE_OFFSET_MS = 60_000;

export default function Disbursements() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { address } = useAccount();
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  
  const [chainFilter, setChainFilter] = useState<number | ''>('');
  const [createChainId, setCreateChainId] = useState<number>(11155111); // Sepolia default
  const filterTokenOptions = useMemo(
    () => [
      { value: '', label: t('disbursements.filters.allTokens') },
      ...Array.from(
        new Set(CHAINS_LIST.flatMap((c) => getTokenSymbolsForChain(c.chainId)))
      ).map((symbol) => ({ value: symbol, label: symbol })),
    ],
    [t]
  );
  const [selectedBeneficiary, setSelectedBeneficiary] = useState('');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('USDC');
  const [memo, setMemo] = useState('');
  const [scheduledAt, setScheduledAt] = useState<string>('');
  const [scheduledAtError, setScheduledAtError] = useState<string | null>(null);
  const [beneficiarySearch, setBeneficiarySearch] = useState('');
  const [beneficiaryTypeFilter, setBeneficiaryTypeFilter] = useState<'all' | 'individual' | 'business'>('all');
  const [isBeneficiaryDropdownOpen, setIsBeneficiaryDropdownOpen] = useState(false);
  const beneficiaryDropdownRef = useRef<HTMLDivElement | null>(null);
  const [manualPaymentOverride, setManualPaymentOverride] = useState(false);
  const [preferredAppliedFor, setPreferredAppliedFor] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDisbursementId, setSelectedDisbursementId] = useState<Id<'disbursements'> | null>(null);
  const [cancelDisbursementId, setCancelDisbursementId] = useState<Id<'disbursements'> | null>(null);
  const [rescheduleDisbursementId, setRescheduleDisbursementId] = useState<Id<'disbursements'> | null>(null);
  const [newScheduledAt, setNewScheduledAt] = useState<string>('');
  const [newScheduledAtError, setNewScheduledAtError] = useState<string | null>(null);

  // Batch disbursement state
  const [recipients, setRecipients] = useState<Array<{ beneficiaryId: string; amount: string }>>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [addMode, setAddMode] = useState<'beneficiary' | 'tag'>('beneficiary');

  // Screening warning state
  const [screeningWarning, setScreeningWarning] = useState<ScreeningWarningState | null>(null);

  // Screening block state
  const [screeningBlock, setScreeningBlock] = useState<{
    flagged: Array<{ beneficiaryId: string; beneficiaryName: string; status: string }>;
    action: 'create' | 'propose' | 'execute';
  } | null>(null);

  // Filter & search state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [tokenFilter, setTokenFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const focusedDisbursementId = searchParams.get('focus') as Id<'disbursements'> | null;
  const prefillBeneficiaryId = searchParams.get('beneficiary') as Id<'beneficiaries'> | null;
  const prefillToken = searchParams.get('token');
  const prefillChainId = searchParams.get('chainId');
  const prefillCreate = searchParams.get('create');
  const [prefillApplied, setPrefillApplied] = useState(false);

  useEffect(() => {
    if (focusedDisbursementId) {
      setSelectedDisbursementId(focusedDisbursementId);
    }
  }, [focusedDisbursementId]);

  useEffect(() => {
    if (!isBeneficiaryDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!beneficiaryDropdownRef.current?.contains(event.target as Node)) {
        setIsBeneficiaryDropdownOpen(false);
        if (selectedBeneficiary && beneficiarySearch) {
          setBeneficiarySearch('');
        }
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsBeneficiaryDropdownOpen(false);
        if (selectedBeneficiary && beneficiarySearch) {
          setBeneficiarySearch('');
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [beneficiarySearch, isBeneficiaryDropdownOpen, selectedBeneficiary]);

  // Sorting state
  const [sortBy, setSortBy] = useState<'createdAt' | 'amount' | 'status' | 'scheduledAt'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Pagination state
  const [cursors, setCursors] = useState<(string | null)[]>([null]); // Stack of cursors for each page
  const [currentPage, setCurrentPage] = useState(0);

  // Build query args
  const queryArgs = useMemo(() => {
    if (!orgId || !address) return null;
    
    return {
      orgId: orgId as Id<'orgs'>,
      sessionToken: getSessionToken() ?? "",
      search: search.trim() || undefined,
      status: statusFilter.length > 0 ? statusFilter : undefined,
      token: tokenFilter || undefined,
      chainId: chainFilter !== '' ? chainFilter : undefined,
      dateFrom: dateFrom ? new Date(dateFrom).getTime() : undefined,
      dateTo: dateTo ? new Date(dateTo).getTime() : undefined,
      sortBy,
      sortOrder,
      cursor: cursors[currentPage] ?? undefined,
      limit: PAGE_SIZE,
    };
  }, [orgId, address, search, statusFilter, tokenFilter, chainFilter, dateFrom, dateTo, sortBy, sortOrder, cursors, currentPage]);

  const disbursementsResult = useQuery(
    api.disbursements.list,
    queryArgs ?? 'skip'
  );

  // Keep previous data while loading to prevent flicker during sort/filter changes
  const lastValidResultRef = useRef(disbursementsResult);
  if (disbursementsResult !== undefined) {
    lastValidResultRef.current = disbursementsResult;
  }
  const displayedResult = disbursementsResult ?? lastValidResultRef.current;
  const isRefreshing = disbursementsResult === undefined && lastValidResultRef.current !== undefined;

  const beneficiaries = useQuery(
    api.beneficiaries.list,
    orgId && address && getSessionToken()
      ? { orgId: orgId as Id<'orgs'>, sessionToken: getSessionToken() ?? "", activeOnly: true, includeTags: true }
      : 'skip'
  );

  const availableTags = useQuery(
    api.tags.list,
    orgId && address && getSessionToken()
      ? { orgId: orgId as Id<'orgs'>, sessionToken: getSessionToken() ?? "" }
      : 'skip'
  );

  const safes = useQuery(
    api.safes.getForOrg,
    orgId && address && getSessionToken()
      ? { orgId: orgId as Id<'orgs'>, sessionToken: getSessionToken() ?? "" }
      : 'skip'
  );
  const org = useQuery(
    api.orgs.get,
    orgId && getSessionToken()
      ? { orgId: orgId as Id<'orgs'>, sessionToken: getSessionToken() ?? "" }
      : 'skip'
  );
  const switchChain = useSwitchChain();
  const currentChainId = useChainId();
  const relaySettings = resolveRelaySettings(org ?? undefined);

  useEffect(() => {
    if (prefillApplied) return;
    if (!prefillBeneficiaryId && !prefillCreate) return;
    if (!beneficiaries) return;

    setIsCreating(true);

    if (prefillBeneficiaryId && beneficiaries.some((b) => b._id === prefillBeneficiaryId)) {
      setSelectedBeneficiary(prefillBeneficiaryId);
    }

    if (prefillChainId) {
      const chainIdNum = Number(prefillChainId);
      if (!Number.isNaN(chainIdNum) && safes?.some((s) => s.chainId === chainIdNum)) {
        setCreateChainId(chainIdNum);
        const availableTokens = getTokenSymbolsForChain(chainIdNum);
        if (prefillToken && availableTokens.includes(prefillToken)) {
          setToken(prefillToken);
        } else if (!availableTokens.includes(token)) {
          setToken(availableTokens[0] ?? 'USDC');
        }
      }
    } else if (prefillToken) {
      const availableTokens = getTokenSymbolsForChain(createChainId);
      if (availableTokens.includes(prefillToken)) {
        setToken(prefillToken);
      }
    }

    setPrefillApplied(true);
  }, [
    beneficiaries,
    createChainId,
    prefillApplied,
    prefillBeneficiaryId,
    prefillChainId,
    prefillCreate,
    prefillToken,
    safes,
    token,
  ]);

  // Fetch token balances for the selected chain
  const balanceContracts = useMemo(() => {
    if (!safes?.length || !createChainId) return undefined;
    const safe = safes.find((s) => s.chainId === createChainId);
    if (!safe) return undefined;

    const tokens = getTokensForChain(createChainId);
    const contracts: Array<{
      address: `0x${string}`;
      abi: typeof erc20Abi;
      functionName: 'balanceOf';
      args: [`0x${string}`];
      chainId: number;
      symbol: string;
      decimals: number;
    }> = [];

    for (const [symbol, config] of Object.entries(tokens)) {
      contracts.push({
        address: config.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [safe.safeAddress as `0x${string}`],
        chainId: createChainId,
        symbol,
        decimals: config.decimals,
      });
    }

    return contracts.length ? contracts : undefined;
  }, [safes, createChainId]);

  const { data: balanceResults } = useReadContracts({
    contracts: balanceContracts,
    query: {
      enabled: !!balanceContracts?.length,
    },
  });

  // Calculate available balance for selected token
  const availableBalance = useMemo(() => {
    if (!balanceContracts || !balanceResults) return null;

    const tokenIndex = balanceContracts.findIndex((c) => c.symbol === token);
    if (tokenIndex === -1) return null;

    const result = balanceResults[tokenIndex]?.result;
    if (result == null) return null;

    const decimals = balanceContracts[tokenIndex].decimals;
    const balance = Number(result) / Math.pow(10, decimals);
    return balance;
  }, [balanceContracts, balanceResults, token]);

  const createDisbursement = useMutation(api.disbursements.create);
  const createBatchDisbursement = useMutation(api.disbursements.createBatch);
  const updateStatus = useMutation(api.disbursements.updateStatus);
  const scheduleDisbursement = useMutation(api.disbursements.schedule);
  const rescheduleDisbursement = useMutation(api.disbursements.reschedule);

  const relayingDisbursements = useMemo(() => {
    if (!displayedResult?.items) return [];
    return displayedResult.items.filter(
      (d) => d.status === 'relaying' && d.relayTaskId
    );
  }, [displayedResult]);

  useEffect(() => {
    if (!RELAY_FEATURE_ENABLED || !address || relayingDisbursements.length === 0) {
      return;
    }

    let cancelled = false;

    const pollRelayStatuses = async () => {
      for (const disbursement of relayingDisbursements) {
        if (!disbursement.relayTaskId) continue;
        try {
          const status = await convex.action(api.relay.getTaskStatus, {
            taskId: disbursement.relayTaskId,
          });

          if (cancelled) return;

          const taskState = status?.taskState;
          const txHash = status?.transactionHash;

          if (txHash) {
            await updateStatus({
              disbursementId: disbursement._id,
              sessionToken: getSessionToken() ?? "",
              status: 'executed',
              txHash,
              relayStatus: taskState,
            });
            continue;
          }

          if (taskState === 'Cancelled' || taskState === 'ExecReverted') {
            await updateStatus({
              disbursementId: disbursement._id,
              sessionToken: getSessionToken() ?? "",
              status: 'failed',
              relayStatus: taskState,
              relayError: taskState,
            });
            continue;
          }

          if (taskState && taskState !== disbursement.relayStatus) {
            await updateStatus({
              disbursementId: disbursement._id,
              sessionToken: getSessionToken() ?? "",
              status: 'relaying',
              relayStatus: taskState,
            });
          }
        } catch (err) {
          console.error('Failed to poll relay status:', err);
        }
      }
    };

    pollRelayStatuses();
    const interval = setInterval(pollRelayStatuses, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, relayingDisbursements, updateStatus]);

  // Helper to reset pagination when filters change
  const resetPagination = () => {
    setCursors([null]);
    setCurrentPage(0);
  };

  // Handler for search input
  const handleSearchChange = (value: string) => {
    setSearch(value);
    resetPagination();
  };

  // Handler for status toggle
  const toggleStatus = (status: string) => {
    setStatusFilter(prev => 
      prev.includes(status) 
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );
    resetPagination();
  };

  // Handler for token filter
  const handleTokenFilterChange = (value: string) => {
    setTokenFilter(value);
    resetPagination();
  };

  // Handler for chain filter
  const handleChainFilterChange = (value: number | '') => {
    setChainFilter(value);
    resetPagination();
  };

  // Handler for date changes
  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    resetPagination();
  };

  const handleDateToChange = (value: string) => {
    setDateTo(value);
    resetPagination();
  };

  const validateScheduledAt = (value: string) => {
    if (!value) return null;
    const ts = new Date(value).getTime();
    if (Number.isNaN(ts)) return t('disbursements.form.scheduleInvalid');
    if (ts < Date.now() + MIN_SCHEDULE_OFFSET_MS) {
      return t('disbursements.form.scheduleTooSoon');
    }
    return null;
  };

  // Handler for sort
  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    resetPagination();
  };

  // Pagination handlers
  const goToNextPage = () => {
    if (displayedResult?.nextCursor) {
      setCursors(prev => [...prev.slice(0, currentPage + 1), displayedResult.nextCursor]);
      setCurrentPage(prev => prev + 1);
    }
  };

  const goToPrevPage = () => {
    if (currentPage > 0) {
      setCurrentPage(prev => prev - 1);
    }
  };

  // Clear all filters
  const clearFilters = () => {
    setSearch('');
    setStatusFilter([]);
    setTokenFilter('');
    setChainFilter('');
    setDateFrom('');
    setDateTo('');
    resetPagination();
  };

  const hasActiveFilters = search || statusFilter.length > 0 || tokenFilter || chainFilter !== '' || dateFrom || dateTo;

  // Calculate total for batch disbursements
  const batchTotal = useMemo(() => {
    let total = 0;
    
    // Include first recipient if filled
    if (selectedBeneficiary && amount) {
      const amt = parseFloat(amount || '0');
      total += isNaN(amt) ? 0 : amt;
    }
    
    // Add recipients
    recipients.forEach(r => {
      const amt = parseFloat(r.amount || '0');
      total += isNaN(amt) ? 0 : amt;
    });
    
    return total;
  }, [recipients, selectedBeneficiary, amount]);

  const hasDraftRecipient = Boolean(selectedBeneficiary && amount && parseFloat(amount) > 0);
  const recipientCount = recipients.length + (hasDraftRecipient ? 1 : 0);
  // Check if in batch mode (once we have at least one recipient)
  const isBatchMode = recipients.length > 0;

  // Get available beneficiaries (exclude already selected ones, but include currently selected one)
  const availableBeneficiaries = useMemo(() => {
    if (!beneficiaries) return [];
    const selectedIds = new Set([
      ...recipients.map(r => r.beneficiaryId)
      // Don't exclude selectedBeneficiary so it shows in the dropdown
    ]);
    return beneficiaries.filter(b => !selectedIds.has(b._id));
  }, [beneficiaries, recipients]);

  const selectedBeneficiaryData = useMemo(
    () => beneficiaries?.find((b) => b._id === selectedBeneficiary) ?? null,
    [beneficiaries, selectedBeneficiary]
  );

  useEffect(() => {
    if (!selectedBeneficiary) {
      setManualPaymentOverride(false);
      setPreferredAppliedFor(null);
      return;
    }

    setManualPaymentOverride(false);
    setPreferredAppliedFor(null);
  }, [selectedBeneficiary]);

  const beneficiaryOptions = useMemo(() => {
    const baseOptions = (() => {
      if (isBatchMode) {
        const selectedBen = selectedBeneficiary
          ? beneficiaries?.find((b) => b._id === selectedBeneficiary)
          : null;
        const allOptions =
          selectedBen && !availableBeneficiaries?.some((b) => b._id === selectedBeneficiary)
            ? [selectedBen, ...(availableBeneficiaries || [])]
            : (availableBeneficiaries || []);
        return allOptions;
      }
      return beneficiaries ?? [];
    })();

    const searchLower = beneficiarySearch.trim().toLowerCase();
    const filtered = baseOptions.filter((b) => {
      const type = b.type ?? 'individual';
      if (beneficiaryTypeFilter !== 'all' && type !== beneficiaryTypeFilter) {
        return false;
      }
      if (!searchLower) return true;
      return (
        b.name.toLowerCase().includes(searchLower) ||
        b.walletAddress.toLowerCase().includes(searchLower)
      );
    });
    if (selectedBeneficiary && !filtered.some((b) => b._id === selectedBeneficiary)) {
      const selected = baseOptions.find((b) => b._id === selectedBeneficiary);
      if (selected) {
        return [selected, ...filtered];
      }
    }
    return filtered;
  }, [
    availableBeneficiaries,
    beneficiarySearch,
    beneficiaryTypeFilter,
    beneficiaries,
    isBatchMode,
    selectedBeneficiary,
  ]);
  const beneficiaryInputValue = isBeneficiaryDropdownOpen
    ? beneficiarySearch
    : (beneficiarySearch || selectedBeneficiaryData?.name || '');

  useEffect(() => {
    if (!selectedBeneficiaryData) return;
    if (recipients.length > 0) return;
    if (manualPaymentOverride) return;
    if (preferredAppliedFor === selectedBeneficiaryData._id) return;

    const preferredChainId = selectedBeneficiaryData.preferredChainId;
    const preferredToken = selectedBeneficiaryData.preferredToken;

    if (preferredChainId && safes?.some((s) => s.chainId === preferredChainId)) {
      if (preferredChainId !== createChainId) {
        setCreateChainId(preferredChainId);
      }
      const availableTokens = getTokenSymbolsForChain(preferredChainId);
      if (preferredToken && availableTokens.includes(preferredToken)) {
        if (preferredToken !== token) {
          setToken(preferredToken);
        }
      } else if (!availableTokens.includes(token)) {
        setToken(availableTokens[0] ?? 'USDC');
      }
      setPreferredAppliedFor(selectedBeneficiaryData._id);
      return;
    }

    if (preferredToken) {
      const availableTokens = getTokenSymbolsForChain(createChainId);
      if (availableTokens.includes(preferredToken) && preferredToken !== token) {
        setToken(preferredToken);
      }
    }
    setPreferredAppliedFor(selectedBeneficiaryData._id);
  }, [
    createChainId,
    manualPaymentOverride,
    preferredAppliedFor,
    recipients.length,
    safes,
    selectedBeneficiaryData,
    token,
  ]);

  const beneficiariesByTag = useMemo(() => {
    if (!beneficiaries || selectedTags.length === 0) return [];
    const selected = new Set(selectedTags.map(normalizeTag));
    return beneficiaries.filter((b) =>
      b.tags?.some((tag: string) => selected.has(normalizeTag(tag)))
    );
  }, [beneficiaries, selectedTags]);

  // Add recipient row (adds current first row to recipients, keeps first row for next entry)
  const addRecipient = () => {
    if (!selectedBeneficiary || !amount) return;
    
    // Check for duplicate
    if (recipients.some(r => r.beneficiaryId === selectedBeneficiary)) {
      setError(t('disbursements.form.duplicateBeneficiary'));
      return;
    }
    
    // Validate amount
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setError(t('disbursements.form.invalidAmount'));
      return;
    }
    
    setError(null);
    setRecipients(prev => [...prev, { beneficiaryId: selectedBeneficiary, amount }]);
    // Clear first row for next entry
    setSelectedBeneficiary('');
    setAmount('');
  };

  const handleSelectBeneficiary = (beneficiaryId: string) => {
    setSelectedBeneficiary(beneficiaryId);
    setBeneficiarySearch('');
    setIsBeneficiaryDropdownOpen(false);
    setError(null);
  };

  const addRecipientsByTag = () => {
    if (selectedTags.length === 0) return;
    if (!beneficiariesByTag.length) {
      setError(t('disbursements.form.noTaggedBeneficiaries'));
      return;
    }

    setError(null);
    setRecipients((prev) => {
      const existing = new Set(prev.map((r) => r.beneficiaryId));
      const updated = [...prev];
      for (const beneficiary of beneficiariesByTag) {
        if (existing.has(beneficiary._id) || beneficiary._id === selectedBeneficiary) {
          continue;
        }
        updated.push({ beneficiaryId: beneficiary._id, amount: '' });
      }
      return updated;
    });
  };

  // Remove recipient row
  const removeRecipient = (index: number) => {
    setRecipients(prev => prev.filter((_, i) => i !== index));
  };

  // Update recipient amount
  const updateRecipientAmount = (index: number, newAmount: string) => {
    setRecipients(prev => prev.map((r, i) => i === index ? { ...r, amount: newAmount } : r));
  };

  // Update recipient beneficiary (reserved for future UI)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- may be wired to UI later
  const updateRecipientBeneficiary = (index: number, beneficiaryId: string) => {
    setRecipients(prev => prev.map((r, i) => i === index ? { ...r, beneficiaryId } : r));
  };

  // Reset form
  const resetForm = () => {
    setSelectedBeneficiary('');
    setAmount('');
    setToken('USDC');
    setMemo('');
    setScheduledAt('');
    setScheduledAtError(null);
    setRecipients([]);
    setSelectedTags([]);
    setAddMode('beneficiary');
    setCreateChainId(11155111);
    setBeneficiarySearch('');
    setBeneficiaryTypeFilter('all');
    setIsCreating(false);
  };

  const handleCreate = async (e: React.FormEvent, skipScreening = false) => {
    e.preventDefault();
    if (!orgId || !address) return;

    const scheduleError = validateScheduledAt(scheduledAt);
    if (scheduleError) {
      setScheduledAtError(scheduleError);
      return;
    }

    // Validate batch mode
    if (isBatchMode || (selectedBeneficiary && amount)) {
      // Include first recipient if it's filled but not yet added to recipients
      const allRecipients = selectedBeneficiary && amount && !recipients.some(r => r.beneficiaryId === selectedBeneficiary)
        ? [...recipients, { beneficiaryId: selectedBeneficiary, amount }]
        : recipients;

      if (allRecipients.length === 0) {
        setError('At least one recipient is required');
        return;
      }

      // Validate all recipients have beneficiary and amount
      for (const recipient of allRecipients) {
        if (!recipient.beneficiaryId || !recipient.amount) {
          setError('All recipients must have a beneficiary and amount');
          return;
        }
        const amt = parseFloat(recipient.amount);
        if (isNaN(amt) || amt <= 0) {
          setError('All amounts must be greater than 0');
          return;
        }
      }

      // Check screening before creating (unless skipping)
      if (!skipScreening) {
        const beneficiaryIds = allRecipients.map(r => r.beneficiaryId as Id<'beneficiaries'>);
        const screeningCheck = await convex.query(api.screeningQueries.checkBeneficiaries, {
          orgId: orgId as Id<'orgs'>,
          sessionToken: getSessionToken() ?? "",
          beneficiaryIds,
        });

        if (screeningCheck.enforcement === 'block' && screeningCheck.flagged.length > 0) {
          setScreeningBlock({
            flagged: screeningCheck.flagged,
            action: 'create',
          });
          return;
        }

        if (screeningCheck.enforcement === 'warn' && screeningCheck.flagged.length > 0) {
          setScreeningWarning({
            flagged: screeningCheck.flagged,
            action: 'create',
            data: { isBatch: true },
          });
          return;
        }
      }

      try {
        await createBatchDisbursement({
          orgId: orgId as Id<'orgs'>,
          sessionToken: getSessionToken() ?? "",
          chainId: createChainId,
          token,
          recipients: allRecipients.map(r => ({
            beneficiaryId: r.beneficiaryId as Id<'beneficiaries'>,
            amount: r.amount,
          })),
          memo: memo.trim() || undefined,
          scheduledAt: scheduledAt ? new Date(scheduledAt).getTime() : undefined,
        });
        resetForm();
      } catch (error) {
        console.error('Failed to create batch disbursement:', error);
        setError(error instanceof Error ? error.message : 'Failed to create batch disbursement');
      }
    } else {
      // Single disbursement
      if (!selectedBeneficiary || !amount) return;

      // Check screening before creating (unless skipping)
      if (!skipScreening) {
        const screeningCheck = await convex.query(api.screeningQueries.checkBeneficiaries, {
          orgId: orgId as Id<'orgs'>,
          sessionToken: getSessionToken() ?? "",
          beneficiaryIds: [selectedBeneficiary as Id<'beneficiaries'>],
        });

        if (screeningCheck.enforcement === 'block' && screeningCheck.flagged.length > 0) {
          setScreeningBlock({
            flagged: screeningCheck.flagged,
            action: 'create',
          });
          return;
        }

        if (screeningCheck.enforcement === 'warn' && screeningCheck.flagged.length > 0) {
          setScreeningWarning({
            flagged: screeningCheck.flagged,
            action: 'create',
            data: { isBatch: false },
          });
          return;
        }
      }

      try {
        await createDisbursement({
          orgId: orgId as Id<'orgs'>,
          sessionToken: getSessionToken() ?? "",
          chainId: createChainId,
          beneficiaryId: selectedBeneficiary as Id<'beneficiaries'>,
          token,
          amount,
          memo: memo.trim() || undefined,
          scheduledAt: scheduledAt ? new Date(scheduledAt).getTime() : undefined,
        });
        resetForm();
      } catch (error) {
        console.error('Failed to create disbursement:', error);
        setError(error instanceof Error ? error.message : 'Failed to create disbursement');
      }
    }
  };

  const handlePropose = async (
    disbursement: {
      _id: Id<'disbursements'>;
      chainId?: number;
      beneficiary?: { walletAddress: string } | null;
      token: string;
      amount?: string;
      type?: 'single' | 'batch';
      totalAmount?: string;
    },
    skipScreening = false
  ) => {
    const chainId = disbursement.chainId;
    if (chainId == null || !safes?.length || !address) return;
    const safe = safes.find((s) => s.chainId === chainId);
    if (!safe) {
      setError('No Safe linked for this chain. Link the Safe for this chain in Settings.');
      return;
    }

    setProcessingId(disbursement._id);
    setError(null);

    try {
      // Check screening before proposing (unless skipping)
      if (!skipScreening) {
        const screeningCheck = await convex.query(api.screeningQueries.checkDisbursementRecipients, {
          disbursementId: disbursement._id,
          sessionToken: getSessionToken() ?? "",
        });

        if (screeningCheck.enforcement === 'block' && screeningCheck.flagged.length > 0) {
          setScreeningBlock({
            flagged: screeningCheck.flagged,
            action: 'propose',
          });
          setProcessingId(null);
          return;
        }

        if (screeningCheck.enforcement === 'warn' && screeningCheck.flagged.length > 0) {
          setScreeningWarning({
            flagged: screeningCheck.flagged,
            action: 'propose',
            data: { disbursement },
          });
          setProcessingId(null);
          return;
        }
      }

      if (switchChain && switchChain.switchChainAsync && currentChainId !== chainId) {
        await switchChain.switchChainAsync({ chainId });
      }

      let relayFeeToken: string | undefined;
      let relayFeeTokenSymbol: string | undefined;
      let relayFeeMode: RelayFeeMode | undefined;

      if (RELAY_FEATURE_ENABLED) {
        const feeSelection = await selectRelayFeeToken({
          chainId,
          safeAddress: safe.safeAddress,
          feeTokenSymbol: relaySettings.relayFeeTokenSymbol,
          feeMode: relaySettings.relayFeeMode,
        });
        relayFeeToken = feeSelection.feeTokenAddress;
        relayFeeTokenSymbol = feeSelection.feeTokenSymbol;
        relayFeeMode = relaySettings.relayFeeMode;
      }

      await updateStatus({
        disbursementId: disbursement._id,
        sessionToken: getSessionToken() ?? "",
        status: 'pending',
      });

      let transactions: Array<{ to: string; value: string; data: string; operation?: number }>;

      if (disbursement.type === 'batch') {
        const batchData = await convex.query(api.disbursements.getWithRecipients, {
          disbursementId: disbursement._id,
          sessionToken: getSessionToken() ?? "",
        });
        if (!batchData || !batchData.recipients || batchData.recipients.length === 0) {
          throw new Error('No recipients found for batch disbursement');
        }
        transactions = createBatchTransferTxs(
          chainId,
          disbursement.token,
          batchData.recipients.map((r: { recipientAddress: string; amount: string }) => ({ to: r.recipientAddress, amount: r.amount }))
        );
      } else {
        const singleAmount = disbursement.amount;
        if (!disbursement.beneficiary || !singleAmount) {
          throw new Error('Beneficiary or amount not found');
        }
        const transferTx = createTransferTx(
          chainId,
          disbursement.token,
          disbursement.beneficiary.walletAddress,
          singleAmount
        );
        transactions = [transferTx];
      }

      const safeTxHash = RELAY_FEATURE_ENABLED
        ? await proposeTransactionViaGelato({
            safeAddress: safe.safeAddress,
            signerAddress: address,
            chainId,
            transactions,
            gasToken: relayFeeToken as `0x${string}` | undefined,
          })
        : await proposeTransaction(
            safe.safeAddress,
            address,
            chainId,
            transactions
          );

      const currentDisb = await convex.query(api.disbursements.get, {
        disbursementId: disbursement._id,
        sessionToken: getSessionToken() ?? "",
      });

      if (currentDisb?.scheduledAt && currentDisb.scheduledAt > Date.now()) {
        await scheduleDisbursement({
          disbursementId: disbursement._id,
          sessionToken: getSessionToken() ?? "",
          scheduledAt: currentDisb.scheduledAt,
          safeTxHash,
          relayFeeToken,
          relayFeeTokenSymbol,
          relayFeeMode,
        });
      } else {
        await updateStatus({
          disbursementId: disbursement._id,
          sessionToken: getSessionToken() ?? "",
          status: 'proposed',
          safeTxHash,
          relayFeeToken,
          relayFeeTokenSymbol,
          relayFeeMode,
        });
      }
    } catch (err) {
      console.error('Failed to propose transaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to propose transaction');
      await updateStatus({
        disbursementId: disbursement._id,
        sessionToken: getSessionToken() ?? "",
        status: 'draft',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleExecute = async (
    disbursement: {
      _id: Id<'disbursements'>;
      chainId?: number;
      safeTxHash?: string;
    },
    skipScreening = false
  ) => {
    const chainId = disbursement.chainId;
    if (chainId == null || !safes?.length || !address || !disbursement.safeTxHash) return;
    const safe = safes.find((s) => s.chainId === chainId);
    if (!safe) {
      setError('No Safe linked for this chain.');
      return;
    }

    setProcessingId(disbursement._id);
    setError(null);

    try {
      // Check screening before executing (unless skipping)
      if (!skipScreening) {
        const screeningCheck = await convex.query(api.screeningQueries.checkDisbursementRecipients, {
          disbursementId: disbursement._id,
          sessionToken: getSessionToken() ?? "",
        });

        if (screeningCheck.enforcement === 'block' && screeningCheck.flagged.length > 0) {
          setScreeningBlock({
            flagged: screeningCheck.flagged,
            action: 'execute',
          });
          setProcessingId(null);
          return;
        }

        if (screeningCheck.enforcement === 'warn' && screeningCheck.flagged.length > 0) {
          setScreeningWarning({
            flagged: screeningCheck.flagged,
            action: 'execute',
            data: { disbursement },
          });
          setProcessingId(null);
          return;
        }
      }

      if (switchChain && switchChain.switchChainAsync && currentChainId !== chainId) {
        await switchChain.switchChainAsync({ chainId });
      }

      if (RELAY_FEATURE_ENABLED) {
        const relayResult = await executeTransactionViaGelato({
          safeAddress: safe.safeAddress,
          signerAddress: address,
          chainId,
          safeTxHash: disbursement.safeTxHash,
        });

        await updateStatus({
          disbursementId: disbursement._id,
          sessionToken: getSessionToken() ?? "",
          status: 'relaying',
          relayTaskId: relayResult.taskId,
          relayStatus: 'submitted',
        });
      } else {
        const txHash = await executeTransaction(
          safe.safeAddress,
          address,
          chainId,
          disbursement.safeTxHash
        );

        await updateStatus({
          disbursementId: disbursement._id,
          sessionToken: getSessionToken() ?? "",
          status: 'executed',
          txHash,
        });
      }
    } catch (err) {
      console.error('Failed to execute transaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to execute transaction');
      await updateStatus({
        disbursementId: disbursement._id,
        sessionToken: getSessionToken() ?? "",
        status: 'failed',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleRetryRelay = async (
    disbursement: {
      _id: Id<'disbursements'>;
      chainId?: number;
      safeTxHash?: string;
    }
  ) => {
    if (!address) return;
    setProcessingId(disbursement._id);
    setError(null);

    try {
      const retryResult = await convex.action(api.relay.retryDisbursement, {
        disbursementId: disbursement._id,
        sessionToken: getSessionToken() ?? "",
      });

      if (retryResult?.status === 'executed') {
        setProcessingId(null);
        return;
      }

      if (retryResult?.status === 'needs_confirmations') {
        const remaining = Math.max(
          0,
          (retryResult.confirmationsRequired ?? 0) -
            (retryResult.confirmations ?? 0)
        );
        setError(
          remaining > 0
            ? `Needs ${remaining} more confirmation(s) before relay.`
            : 'Needs more confirmations before relay.'
        );
        setProcessingId(null);
        return;
      }

      if (retryResult?.status === 'not_found') {
        setError('Safe transaction not found. Please re-propose the disbursement.');
        setProcessingId(null);
        return;
      }

      setProcessingId(null);
      await handleExecute(disbursement);
    } catch (err) {
      console.error('Failed to retry relay:', err);
      setError(err instanceof Error ? err.message : 'Failed to retry relay');
      setProcessingId(null);
    }
  };

  const handleCancel = async (disbursementId: Id<'disbursements'>) => {
    if (!address) return;
    
    setCancelDisbursementId(disbursementId);
  };

  const confirmCancel = async () => {
    if (!address || !cancelDisbursementId) return;

    try {
      await updateStatus({
        disbursementId: cancelDisbursementId,
        sessionToken: getSessionToken() ?? "",
        status: 'cancelled',
      });
      setCancelDisbursementId(null);
    } catch (err) {
      console.error('Failed to cancel disbursement:', err);
      setError(err instanceof Error ? err.message : 'Failed to cancel disbursement');
      setCancelDisbursementId(null);
    }
  };

  const handleReschedule = async () => {
    if (!rescheduleDisbursementId || !newScheduledAt || !address) return;
    const scheduleError = validateScheduledAt(newScheduledAt);
    if (scheduleError) {
      setNewScheduledAtError(scheduleError);
      return;
    }
    try {
      await rescheduleDisbursement({
        disbursementId: rescheduleDisbursementId,
        sessionToken: getSessionToken() ?? "",
        newScheduledAt: new Date(newScheduledAt).getTime(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reschedule');
    }
    setRescheduleDisbursementId(null);
    setNewScheduledAt('');
    setNewScheduledAtError(null);
  };

  const renderActionButton = (disbursement: NonNullable<typeof disbursementsResult>['items'][number]) => {
    const isProcessing = processingId === disbursement._id;

    if (isProcessing) {
      return (
        <div className="flex items-center justify-center gap-2 h-8">
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        </div>
      );
    }

    switch (disbursement.status) {
      case 'draft':
        return (
          <div className="flex items-center justify-center gap-2 h-8">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePropose(disbursement)}
              title={t('disbursements.actions.propose')}
              className="h-8 w-8 p-0"
            >
              <Play className="h-4 w-4 text-accent-400" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCancel(disbursement._id)}
              title="Cancel"
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4 text-slate-400 hover:text-red-400" />
            </Button>
          </div>
        );
      case 'pending':
        return (
          <div className="flex items-center justify-center gap-2 h-8">
            <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCancel(disbursement._id)}
              title="Cancel"
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4 text-slate-400 hover:text-red-400" />
            </Button>
          </div>
        );
      case 'proposed':
        return (
          <div className="flex items-center justify-center gap-2 h-8">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleExecute(disbursement)}
              title={t('disbursements.actions.execute')}
              className="h-8 w-8 p-0"
            >
              <Rocket className="h-4 w-4 text-yellow-400" />
            </Button>
          </div>
        );
      case 'scheduled':
        return (
          <div className="flex items-center justify-center gap-2 h-8">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRescheduleDisbursementId(disbursement._id);
                setNewScheduledAt(
                  disbursement.scheduledAt
                    ? toLocalDateTimeInputValue(new Date(disbursement.scheduledAt))
                    : ''
                );
                setNewScheduledAtError(null);
              }}
              title={t('disbursements.actions.reschedule')}
              className="h-8 w-8 p-0"
            >
              <Calendar className="h-4 w-4 text-yellow-400" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCancel(disbursement._id)}
              title="Cancel"
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4 text-slate-400 hover:text-red-400" />
            </Button>
          </div>
        );
      case 'relaying':
        return (
          <div className="flex items-center justify-center gap-2 h-8">
            <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />
          </div>
        );
      case 'executed':
        return (
          <div className="flex items-center justify-center gap-2 h-8">
            <CheckCircle className="h-4 w-4 text-green-400" />
            {disbursement.txHash && (
              <a
                href={disbursement.chainId != null ? getBlockExplorerTxUrl(disbursement.chainId, disbursement.txHash) : `https://etherscan.io/tx/${disbursement.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-8 w-8 text-accent-400 hover:text-accent-300 transition-colors"
                title="View transaction"
              >
                <ArrowUpRight className="h-4 w-4" />
              </a>
            )}
          </div>
        );
      case 'failed':
        return (
          <div className="flex items-center justify-center gap-2 h-8">
            {disbursement.safeTxHash ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  handleRetryRelay({
                    _id: disbursement._id,
                    chainId: disbursement.chainId,
                    safeTxHash: disbursement.safeTxHash,
                  })
                }
                title="Retry relay"
                className="h-8 w-8 p-0"
              >
                <RefreshCw className="h-4 w-4 text-slate-400 hover:text-accent-300" />
              </Button>
            ) : null}
          </div>
        );
      case 'cancelled':
        return (
          <div className="flex items-center justify-center gap-2 h-8">
            {/* Empty div to maintain consistent height */}
          </div>
        );
      default:
        return (
          <div className="flex items-center justify-center gap-2 h-8">
            {/* Empty div to maintain consistent height */}
          </div>
        );
    }
  };

  const closeDetailModal = () => {
    setSelectedDisbursementId(null);
    if (searchParams.has('focus')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('focus');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const renderActionButtonsDetailed = (disbursement: {
    _id: Id<'disbursements'>;
    status: string;
    chainId?: number;
    safeTxHash?: string;
    txHash?: string;
    token: string;
    amount?: string;
    totalAmount?: string;
    type?: 'single' | 'batch';
    beneficiary?: { walletAddress: string } | null;
    scheduledAt?: number;
  }) => {
    const isProcessing = processingId === disbursement._id;

    if (isProcessing) {
      return (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      );
    }

    switch (disbursement.status) {
      case 'draft':
        return (
          <>
            <Button
              onClick={() => handlePropose(disbursement)}
              className="w-full sm:w-auto"
            >
              {t('disbursements.actions.propose')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                closeDetailModal();
                handleCancel(disbursement._id);
              }}
              className="w-full sm:w-auto border border-red-500/30 text-red-400 hover:text-red-300 hover:border-red-400/50"
            >
              {t('common.cancel')}
            </Button>
          </>
        );
      case 'pending':
        return (
          <Button
            variant="secondary"
            onClick={() => {
              closeDetailModal();
              handleCancel(disbursement._id);
            }}
            className="w-full sm:w-auto border border-red-500/30 text-red-400 hover:text-red-300 hover:border-red-400/50"
          >
            {t('common.cancel')}
          </Button>
        );
      case 'proposed':
        return (
          <Button
            onClick={() => handleExecute(disbursement)}
            className="w-full sm:w-auto"
          >
            {t('disbursements.actions.execute')}
          </Button>
        );
      case 'scheduled':
        return (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                closeDetailModal();
                setRescheduleDisbursementId(disbursement._id);
                setNewScheduledAt(
                  disbursement.scheduledAt
                    ? toLocalDateTimeInputValue(new Date(disbursement.scheduledAt))
                    : ''
                );
                setNewScheduledAtError(null);
              }}
              className="w-full sm:w-auto"
            >
              {t('disbursements.actions.reschedule')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                closeDetailModal();
                handleCancel(disbursement._id);
              }}
              className="w-full sm:w-auto border border-red-500/30 text-red-400 hover:text-red-300 hover:border-red-400/50"
            >
              {t('common.cancel')}
            </Button>
          </>
        );
      case 'failed':
        return disbursement.safeTxHash ? (
          <Button
            variant="secondary"
            onClick={() =>
              handleRetryRelay({
                _id: disbursement._id,
                chainId: disbursement.chainId,
                safeTxHash: disbursement.safeTxHash,
              })
            }
            className="w-full sm:w-auto"
          >
            {t('disbursements.actions.retry', { defaultValue: 'Retry' })}
          </Button>
        ) : null;
      case 'executed':
        return disbursement.txHash ? (
          <a
            href={disbursement.chainId != null ? getBlockExplorerTxUrl(disbursement.chainId, disbursement.txHash) : `https://etherscan.io/tx/${disbursement.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full sm:w-auto"
          >
            <Button variant="secondary" className="w-full sm:w-auto">
              {t('common.view')}
            </Button>
          </a>
        ) : null;
      case 'relaying':
        return (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('status.relaying')}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-4 lg:pt-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">{t('disbursements.title')}</h1>
            <p className="mt-1 text-sm sm:text-base text-slate-400">
              {t('disbursements.subtitle')}
              {displayedResult && (
                <span className="ml-2 text-slate-500">
                  ({t('disbursements.total', { count: displayedResult.totalCount })})
                  {isRefreshing && (
                    <RefreshCw className="ml-2 inline h-3 w-3 animate-spin" />
                  )}
                </span>
              )}
            </p>
          </div>
          <Button onClick={() => setIsCreating(true)} disabled={!safes?.length} className="w-full sm:w-auto h-11">
            <Plus className="h-4 w-4" />
            {t('disbursements.newDisbursement')}
          </Button>
        </div>

        {/* Search & Filter Bar */}
        <DisbursementsFilterBar
          search={search}
          handleSearchChange={handleSearchChange}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          statusFilter={statusFilter}
          toggleStatus={toggleStatus}
          filterTokenOptions={filterTokenOptions}
          tokenFilter={tokenFilter}
          handleTokenFilterChange={handleTokenFilterChange}
          chainFilter={chainFilter}
          handleChainFilterChange={handleChainFilterChange}
          dateFrom={dateFrom}
          handleDateFromChange={handleDateFromChange}
          dateTo={dateTo}
          handleDateToChange={handleDateToChange}
          clearFilters={clearFilters}
          hasActiveFilters={hasActiveFilters}
          safes={safes}
        />

        {/* Error Message */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-4 text-red-300 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Create Form */}
        <CreateDisbursementForm
          isCreating={isCreating}
          createChainId={createChainId}
          setCreateChainId={setCreateChainId}
          selectedBeneficiary={selectedBeneficiary}
          amount={amount}
          setAmount={setAmount}
          token={token}
          setToken={setToken}
          memo={memo}
          setMemo={setMemo}
          scheduledAt={scheduledAt}
          setScheduledAt={setScheduledAt}
          scheduledAtError={scheduledAtError}
          setScheduledAtError={setScheduledAtError}
          beneficiaryTypeFilter={beneficiaryTypeFilter}
          setBeneficiaryTypeFilter={setBeneficiaryTypeFilter}
          setBeneficiarySearch={setBeneficiarySearch}
          isBatchMode={isBatchMode}
          isBeneficiaryDropdownOpen={isBeneficiaryDropdownOpen}
          setIsBeneficiaryDropdownOpen={setIsBeneficiaryDropdownOpen}
          setManualPaymentOverride={setManualPaymentOverride}
          setPreferredAppliedFor={setPreferredAppliedFor}
          recipients={recipients}
          selectedTags={selectedTags}
          setSelectedTags={setSelectedTags}
          addMode={addMode}
          setAddMode={setAddMode}
          availableBalance={availableBalance}
          availableTags={availableTags ?? []}
          beneficiaries={beneficiaries as never}
          beneficiariesByTag={beneficiariesByTag}
          batchTotal={batchTotal}
          beneficiaryDropdownRef={beneficiaryDropdownRef}
          beneficiaryInputValue={beneficiaryInputValue}
          beneficiaryOptions={beneficiaryOptions}
          hasDraftRecipient={hasDraftRecipient}
          recipientCount={recipientCount}
          selectedBeneficiaryData={selectedBeneficiaryData}
          resetForm={resetForm}
          handleCreate={handleCreate}
          handleSelectBeneficiary={handleSelectBeneficiary}
          addRecipient={addRecipient}
          addRecipientsByTag={addRecipientsByTag}
          removeRecipient={removeRecipient}
          updateRecipientAmount={updateRecipientAmount}
          validateScheduledAt={validateScheduledAt}
          safes={safes}
        />

        {/* Disbursements List */}
        <DisbursementsList
          displayedResult={displayedResult}
          isRefreshing={isRefreshing}
          sortBy={sortBy}
          sortOrder={sortOrder}
          handleSort={handleSort}
          renderActionButton={renderActionButton}
          goToNextPage={goToNextPage}
          goToPrevPage={goToPrevPage}
          currentPage={currentPage}
          pageSize={PAGE_SIZE}
          hasActiveFilters={Boolean(hasActiveFilters)}
          clearFilters={clearFilters}
          setSelectedDisbursementId={setSelectedDisbursementId}
        />

        {/* Batch Detail Modal */}
        {selectedDisbursementId && (
          <BatchDetailModal
            disbursementId={selectedDisbursementId}
            onClose={closeDetailModal}
            renderActions={renderActionButtonsDetailed}
          />
        )}

        {/* Cancel Confirmation Modal */}
        <CancelConfirmModal
          cancelDisbursementId={cancelDisbursementId}
          setCancelDisbursementId={setCancelDisbursementId}
          confirmCancel={confirmCancel}
        />

        {/* Reschedule Modal */}
        <RescheduleModal
          rescheduleDisbursementId={rescheduleDisbursementId}
          setRescheduleDisbursementId={setRescheduleDisbursementId}
          newScheduledAt={newScheduledAt}
          setNewScheduledAt={setNewScheduledAt}
          newScheduledAtError={newScheduledAtError}
          setNewScheduledAtError={setNewScheduledAtError}
          validateScheduledAt={validateScheduledAt}
          handleReschedule={handleReschedule}
        />

        {/* Screening Warning Modal */}
        <ScreeningWarningModal
          screeningWarning={screeningWarning}
          setScreeningWarning={setScreeningWarning}
          handleCreate={handleCreate}
          handlePropose={
            handlePropose as (
              d: { _id: Id<'disbursements'>; chainId?: number; safeTxHash?: string },
              skipScreening?: boolean
            ) => void | Promise<void>
          }
          handleExecute={handleExecute}
        />

        {/* Screening Block Modal */}
        <ScreeningBlockModal
          screeningBlock={screeningBlock}
          setScreeningBlock={setScreeningBlock}
        />
      </div>
    </AppLayout>
  );
}
