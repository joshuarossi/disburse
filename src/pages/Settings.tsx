import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ui/ThemeSwitcher';
import {
  Wallet,
  Building2,
  ArrowUpRight,
  Loader2,
  Save,
  AlertCircle,
  X,
  CreditCard,
  Check,
  Copy,
  ExternalLink,
  CheckCircle,
  SlidersHorizontal,
  Shield,
  Rocket,
} from 'lucide-react';
import { validateSafeAddress, isOwner } from '@/lib/safe';
import { TOKENS } from '@/lib/wagmi';
import { encodeFunctionData, parseUnits } from 'viem';
import { CHAINS_LIST, getChainName, getSafeAppUrl } from '@/lib/chains';
import { getPlanFeatureKey, PLANS, type PlanKey } from '@/lib/billingPlans';
import {
  DEFAULT_RELAY_FEE_MODE,
  DEFAULT_RELAY_FEE_TOKEN_SYMBOL,
  RELAY_FEATURE_ENABLED,
  SUPPORTED_RELAY_FEE_TOKENS,
  resolveRelaySettings,
  type RelayFeeMode,
  type RelayFeeTokenSymbol,
} from '@/lib/relayConfig';

const SEPOLIA_CHAIN_ID = 11155111;

// Platform wallet address for receiving payments (Sepolia testnet)
const PLATFORM_WALLET = '0x742d35Cc6634C0532925a3b844Bc9e7595f7aa22' as const;


// ERC20 ABI for transfer
const erc20Abi = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export default function Settings() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();

  // Organization state
  const [orgName, setOrgName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  
  // Safe state
  const [safeAddress, setSafeAddress] = useState('');
  const [selectedChainId, setSelectedChainId] = useState<number>(11155111);
  const [isLinking, setIsLinking] = useState(false);
  const [linkingError, setLinkingError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Billing state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('team');
  const [selectedToken, setSelectedToken] = useState<'USDC' | 'USDT'>('USDC');
  const [manualTxHash, setManualTxHash] = useState('');
  const [paymentStep, setPaymentStep] = useState<'select' | 'pay' | 'confirm' | 'success'>('select');
  const [billingError, setBillingError] = useState<string | null>(null);

  // Relay fee settings
  const [relayFeeTokenSymbol, setRelayFeeTokenSymbol] = useState<RelayFeeTokenSymbol>(
    DEFAULT_RELAY_FEE_TOKEN_SYMBOL
  );
  const [relayFeeMode, setRelayFeeMode] = useState<RelayFeeMode>(
    DEFAULT_RELAY_FEE_MODE
  );
  const [relaySettingsLoaded, setRelaySettingsLoaded] = useState(false);
  const [savingRelaySettings, setSavingRelaySettings] = useState(false);
  const [relaySettingsError, setRelaySettingsError] = useState<string | null>(null);

  // Transaction sending via wagmi
  const { data: txHash, sendTransaction, isPending: isSending } = useSendTransaction();

  // Wait for transaction receipt
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const org = useQuery(
    api.orgs.get,
    orgId ? { orgId: orgId as Id<'orgs'> } : 'skip'
  );

  const safes = useQuery(
    api.safes.getForOrg,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );
  const depositAddress = safes && safes.length > 0 ? safes[0].safeAddress : undefined;
  const linkedChainIds = new Set((safes ?? []).map((s) => s.chainId));
  const availableChainsToLink = CHAINS_LIST.filter((c) => !linkedChainIds.has(c.chainId));

  const members = useQuery(
    api.orgs.listMembers,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const billing = useQuery(
    api.billing.get,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  // Get current user's role
  const currentUserRole = members?.find(
    (m) => m?.walletAddress.toLowerCase() === address?.toLowerCase()
  )?.role;
  const isAdmin = currentUserRole === 'admin';

  const updateOrgName = useMutation(api.orgs.updateName);
  const linkSafe = useMutation(api.safes.link);
  const unlinkSafe = useMutation(api.safes.unlink);
  const subscribe = useMutation(api.billing.subscribe);
  const updateScreeningEnforcement = useMutation(api.screeningMutations.updateScreeningEnforcement);
  const updateRelaySettings = useMutation(api.orgs.updateRelaySettings);

  const screeningEnforcement = useQuery(
    api.screeningQueries.getScreeningEnforcement,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );
  const [savingEnforcement, setSavingEnforcement] = useState(false);

  // Initialize org name when loaded
  if (org?.name && !orgName && !isEditingName) {
    setOrgName(org.name);
  }

  const resolvedRelaySettings = resolveRelaySettings(org ?? undefined);
  if (org && !relaySettingsLoaded) {
    setRelayFeeTokenSymbol(resolvedRelaySettings.relayFeeTokenSymbol);
    setRelayFeeMode(resolvedRelaySettings.relayFeeMode);
    setRelaySettingsLoaded(true);
  }

  const handleSaveOrgName = async () => {
    if (!orgId || !address || !orgName.trim()) return;
    
    setSavingName(true);
    try {
      await updateOrgName({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        name: orgName.trim(),
      });
      setIsEditingName(false);
    } catch (error) {
      console.error('Failed to update org name:', error);
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveRelaySettings = async () => {
    if (!orgId || !address) return;
    setSavingRelaySettings(true);
    setRelaySettingsError(null);
    try {
      await updateRelaySettings({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        relayFeeTokenSymbol,
        relayFeeMode,
      });
    } catch (error) {
      console.error('Failed to update relay settings:', error);
      setRelaySettingsError(
        error instanceof Error ? error.message : 'Failed to update relay settings'
      );
    } finally {
      setSavingRelaySettings(false);
    }
  };

  const handleLinkSafe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !address || !safeAddress.trim()) return;

    setIsValidating(true);
    setLinkingError(null);

    try {
      const isValid = await validateSafeAddress(safeAddress.trim(), selectedChainId);
      if (!isValid) {
        setLinkingError('Invalid Safe address. Please check the address and network.');
        setIsValidating(false);
        return;
      }

      const userIsOwner = await isOwner(safeAddress.trim(), address, selectedChainId);
      if (!userIsOwner) {
        setLinkingError('You must be an owner of this Safe to link it.');
        setIsValidating(false);
        return;
      }

      setIsValidating(false);

      await linkSafe({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        safeAddress: safeAddress.trim(),
        chainId: selectedChainId,
      });
      setSafeAddress('');
      if (availableChainsToLink.length <= 1) setIsLinking(false);
    } catch (error) {
      console.error('Failed to link safe:', error);
      setLinkingError(error instanceof Error ? error.message : 'Failed to link Safe');
      setIsValidating(false);
    }
  };

  const handleUnlinkSafe = async (safeId: Id<'safes'>) => {
    if (!address) return;
    if (!confirm(t('settings.safe.unlinkConfirm'))) return;
    try {
      await unlinkSafe({ safeId, walletAddress: address });
    } catch (error) {
      console.error('Failed to unlink safe:', error);
    }
  };

  const handleUpdateEnforcement = async (enforcement: 'block' | 'warn' | 'off') => {
    if (!orgId || !address) return;
    setSavingEnforcement(true);
    try {
      await updateScreeningEnforcement({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        enforcement,
      });
    } catch (error) {
      console.error('Failed to update screening enforcement:', error);
    } finally {
      setSavingEnforcement(false);
    }
  };

  // Billing handlers
  const handleOpenPayment = (plan: PlanKey) => {
    setSelectedPlan(plan);
    setShowPaymentModal(true);
    setPaymentStep('select');
    setBillingError(null);
    setManualTxHash('');
  };

  const handleClosePayment = () => {
    setShowPaymentModal(false);
    setPaymentStep('select');
    setBillingError(null);
    setManualTxHash('');
  };

  const handlePayWithWallet = async () => {
    if (!address) return;

    setBillingError(null);
    setPaymentStep('pay');

    try {
      const tokenConfig = TOKENS[selectedToken];
      const price = PLANS[selectedPlan].price.toString();
      const amount = parseUnits(price, tokenConfig.decimals);
      
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [PLATFORM_WALLET, amount],
      });

      sendTransaction({
        to: tokenConfig.address,
        data,
      });
    } catch (err) {
      console.error('Payment failed:', err);
      setBillingError(err instanceof Error ? err.message : 'Payment failed');
      setPaymentStep('select');
    }
  };

  const handleConfirmPayment = async (hash: string) => {
    if (!orgId || !address || !hash) return;

    setBillingError(null);

    try {
      // Calculate paid through date (30 days from now)
      const paidThroughAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await subscribe({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        plan: selectedPlan,
        txHash: hash,
        paidThroughAt,
      });

      setPaymentStep('success');
    } catch (err) {
      console.error('Failed to subscribe:', err);
      setBillingError(err instanceof Error ? err.message : 'Failed to subscribe');
    }
  };

  // Handle wallet payment confirmation
  if (txHash && isConfirmed && paymentStep === 'pay') {
    handleConfirmPayment(txHash);
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const currentPlan = billing?.plan || 'trial';
  const isCurrentPlan = (plan: string) => currentPlan === plan;
  const canUpgrade = (plan: PlanKey) => {
    if (currentPlan === 'trial') return true;
    const planOrder = ['starter', 'team', 'pro'];
    return planOrder.indexOf(plan) > planOrder.indexOf(currentPlan);
  };
  const relaySettingsChanged =
    relayFeeTokenSymbol !== resolvedRelaySettings.relayFeeTokenSymbol ||
    relayFeeMode !== resolvedRelaySettings.relayFeeMode;

  return (
    <AppLayout>
      <div className="space-y-4 sm:space-y-6 lg:space-y-8 w-full max-w-full overflow-x-hidden">
        {/* Header */}
        <div className="pt-4 lg:pt-6">
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('settings.title')}</h1>
          <p className="mt-1 text-sm sm:text-base text-slate-400">
            {t('settings.subtitle')}
          </p>
        </div>

        {/* Organization Info */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-4 sm:mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-white">{t('settings.organization.title')}</h2>
              <p className="text-xs sm:text-sm text-slate-400">{t('settings.organization.subtitle')}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('settings.organization.orgName')}
                </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                    setIsEditingName(true);
                  }}
                  disabled={!isAdmin}
                  className="flex-1 rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white disabled:opacity-50"
                />
                {isAdmin && isEditingName && (
                  <Button onClick={handleSaveOrgName} disabled={savingName} className="w-full sm:w-auto h-11">
                    {savingName ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {t('settings.organization.save')}
                  </Button>
                )}
              </div>
              {!isAdmin && (
                <p className="mt-2 text-sm text-slate-500">
                  {t('settings.organization.adminOnly')}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Safe Configuration */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-4 sm:mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
              <Wallet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-white">{t('settings.safe.title')}</h2>
              <p className="text-xs sm:text-sm text-slate-400">{t('settings.safe.subtitle')}</p>
            </div>
          </div>

          {safes && safes.length > 0 ? (
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('settings.safe.depositAddress', { defaultValue: 'Deposit address (same on all chains)' })}
                </label>
                <div className="rounded-lg border border-white/10 bg-navy-800 p-4">
                  <p className="font-mono text-sm text-white break-all">{depositAddress}</p>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('settings.safe.linkedChains', { defaultValue: 'Linked chains' })}
                </label>
                <div className="space-y-2">
                  {safes.map((safe) => {
                    return (
                      <div
                        key={safe._id}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-white/10 bg-navy-800 p-4"
                      >
                        <div className="flex items-center gap-3">
                          <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                            {getChainName(safe.chainId)}
                          </span>
                          <a
                            href={getSafeAppUrl(safe.chainId, safe.safeAddress)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-sm text-accent-400 hover:text-accent-300 transition-colors"
                          >
                            {t('settings.safe.openSafe')}
                            <ArrowUpRight className="h-4 w-4" />
                          </a>
                        </div>
                        {isAdmin && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleUnlinkSafe(safe._id)}
                            className="w-full sm:w-auto"
                          >
                            {t('settings.safe.unlinkSafe')}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {isAdmin && availableChainsToLink.length > 0 && !isLinking && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setIsLinking(true);
                    setSafeAddress(depositAddress ?? '');
                    setSelectedChainId(availableChainsToLink[0].chainId);
                  }}
                  className="w-full sm:w-auto h-11"
                >
                  {t('settings.safe.addChain', { defaultValue: 'Add another chain' })}
                </Button>
              )}
            </div>
          ) : null}
          {isLinking ? (
            <form onSubmit={handleLinkSafe} className="mt-6 space-y-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('settings.safe.safeAddress')}
                </label>
                <input
                  type="text"
                  value={safeAddress}
                  onChange={(e) => {
                    setSafeAddress(e.target.value);
                    setLinkingError(null);
                  }}
                  placeholder="0x..."
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 font-mono text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
                <p className="mt-2 text-xs text-slate-500">
                  {t('settings.safe.safeAddressDescription')}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('settings.safe.chain', { defaultValue: 'Chain' })}
                </label>
                <select
                  value={selectedChainId}
                  onChange={(e) => setSelectedChainId(Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                >
                  {(safes && safes.length > 0 ? availableChainsToLink : CHAINS_LIST).map((c) => (
                    <option key={c.chainId} value={c.chainId}>
                      {c.chainName}
                    </option>
                  ))}
                </select>
              </div>

              {linkingError && (
                <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
                  <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-400">{linkingError}</p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button type="submit" disabled={isValidating} className="w-full sm:w-auto h-11">
                  {isValidating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('settings.safe.validating')}
                    </>
                  ) : (
                    t('settings.safe.linkSafe')
                  )}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setIsLinking(false);
                    setLinkingError(null);
                  }}
                  className="w-full sm:w-auto h-11"
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          ) : null}
          {(!safes || safes.length === 0) && !isLinking ? (
            <div className="text-center py-6">
              <Wallet className="mx-auto h-12 w-12 text-slate-500" />
              <p className="mt-4 text-sm sm:text-base text-slate-400">{t('settings.safe.noSafe')}</p>
              {isAdmin && (
                <Button className="mt-4 w-full sm:w-auto h-11" onClick={() => { setIsLinking(true); setSelectedChainId(SEPOLIA_CHAIN_ID); }}>
                  {t('settings.safe.linkExisting')}
                </Button>
              )}
              <p className="mt-4 text-xs sm:text-sm text-slate-500">
                {t('settings.safe.createSafe')}{' '}
                <a
                  href="https://app.safe.global/new-safe/create"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-400 hover:underline"
                >
                  {t('settings.safe.createSafeLink')}
                </a>
              </p>
            </div>
          ) : null}
        </div>

        {/* Relay Fee Settings */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-4 sm:mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
              <Rocket className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-white">
                {t('settings.relay.title')}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                {t('settings.relay.subtitle')}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                {t('settings.relay.feeTokenLabel')}
              </label>
              <select
                value={relayFeeTokenSymbol}
                onChange={(e) =>
                  setRelayFeeTokenSymbol(e.target.value as RelayFeeTokenSymbol)
                }
                disabled={!isAdmin || !RELAY_FEATURE_ENABLED}
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white disabled:opacity-50"
              >
                {SUPPORTED_RELAY_FEE_TOKENS.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                {t('settings.relay.feeTokenDescription')}
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                {t('settings.relay.feeModeLabel')}
              </label>
              <select
                value={relayFeeMode}
                onChange={(e) =>
                  setRelayFeeMode(e.target.value as RelayFeeMode)
                }
                disabled={!isAdmin || !RELAY_FEATURE_ENABLED}
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white disabled:opacity-50"
              >
                <option value="stablecoin_preferred">
                  {t('settings.relay.feeModePreferred')}
                </option>
                <option value="stablecoin_only">
                  {t('settings.relay.feeModeOnly')}
                </option>
              </select>
              <p className="mt-2 text-xs text-slate-500">
                {t('settings.relay.feeModeDescription')}
              </p>
              {!RELAY_FEATURE_ENABLED && (
                <p className="mt-2 text-xs text-slate-500">
                  {t('settings.relay.disabled')}
                </p>
              )}
            </div>

            {relaySettingsError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {relaySettingsError}
              </div>
            )}

            {isAdmin ? (
              <Button
                onClick={handleSaveRelaySettings}
                disabled={!relaySettingsChanged || savingRelaySettings || !RELAY_FEATURE_ENABLED}
                className="w-full sm:w-auto h-11"
              >
                {savingRelaySettings ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t('settings.relay.save')}
              </Button>
            ) : (
              <p className="text-sm text-slate-500">
                {t('settings.relay.adminOnly')}
              </p>
            )}
          </div>
        </div>

        {/* Preferences */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-4 sm:mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-white">{t('settings.preferences.title')}</h2>
              <p className="text-xs sm:text-sm text-slate-400">{t('settings.preferences.subtitle')}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm font-medium text-slate-300 shrink-0">
                {t('settings.language.selectLanguage')}
              </label>
              <div className="w-56 rounded-lg border border-white/10 bg-navy-800/50 p-1">
                <LanguageSwitcher variant="secondary" size="default" />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label className="text-sm font-medium text-slate-300 shrink-0">
                {t('settings.appearance.selectTheme')}
              </label>
              <div className="w-56 rounded-lg border border-white/10 bg-navy-800/50 p-1">
                <ThemeSwitcher variant="secondary" size="default" />
              </div>
            </div>
          </div>
        </div>

        {/* Security & Compliance */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-4 sm:mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
              <Shield className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-white">{t('settings.screening.title')}</h2>
              <p className="text-xs sm:text-sm text-slate-400">{t('settings.screening.subtitle')}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                {t('settings.screening.enforcement')}
              </label>
              <p className="mb-4 text-xs sm:text-sm text-slate-400">
                {t('settings.screening.enforcementDescription')}
              </p>
              
              {!isAdmin && (
                <p className="mb-4 text-sm text-slate-500">
                  {t('settings.screening.adminOnly')}
                </p>
              )}

              {screeningEnforcement === undefined ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Off Option */}
                  <label
                    className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                      screeningEnforcement === 'off'
                        ? 'border-accent-500 bg-accent-500/10'
                        : 'border-white/10 bg-navy-800/30 hover:border-white/20'
                    } ${!isAdmin || savingEnforcement ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <input
                      type="radio"
                      name="screeningEnforcement"
                      value="off"
                      checked={screeningEnforcement === 'off'}
                      onChange={() => isAdmin && !savingEnforcement && handleUpdateEnforcement('off')}
                      disabled={!isAdmin || savingEnforcement}
                      className="mt-1 h-4 w-4 text-accent-500 focus:ring-accent-500 focus:ring-offset-navy-900"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-white">{t('settings.screening.options.off')}</span>
                        {savingEnforcement && screeningEnforcement === 'off' && (
                          <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-slate-400">
                        {t('settings.screening.options.offDescription')}
                      </p>
                    </div>
                  </label>

                  {/* Warn Option */}
                  <label
                    className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                      screeningEnforcement === 'warn'
                        ? 'border-accent-500 bg-accent-500/10'
                        : 'border-white/10 bg-navy-800/30 hover:border-white/20'
                    } ${!isAdmin || savingEnforcement ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <input
                      type="radio"
                      name="screeningEnforcement"
                      value="warn"
                      checked={screeningEnforcement === 'warn'}
                      onChange={() => isAdmin && !savingEnforcement && handleUpdateEnforcement('warn')}
                      disabled={!isAdmin || savingEnforcement}
                      className="mt-1 h-4 w-4 text-accent-500 focus:ring-accent-500 focus:ring-offset-navy-900"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-white">{t('settings.screening.options.warn')}</span>
                        {savingEnforcement && screeningEnforcement === 'warn' && (
                          <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-slate-400">
                        {t('settings.screening.options.warnDescription')}
                      </p>
                    </div>
                  </label>

                  {/* Block Option */}
                  <label
                    className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                      screeningEnforcement === 'block'
                        ? 'border-accent-500 bg-accent-500/10'
                        : 'border-white/10 bg-navy-800/30 hover:border-white/20'
                    } ${!isAdmin || savingEnforcement ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <input
                      type="radio"
                      name="screeningEnforcement"
                      value="block"
                      checked={screeningEnforcement === 'block'}
                      onChange={() => isAdmin && !savingEnforcement && handleUpdateEnforcement('block')}
                      disabled={!isAdmin || savingEnforcement}
                      className="mt-1 h-4 w-4 text-accent-500 focus:ring-accent-500 focus:ring-offset-navy-900"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-white">{t('settings.screening.options.block')}</span>
                        {savingEnforcement && screeningEnforcement === 'block' && (
                          <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-slate-400">
                        {t('settings.screening.options.blockDescription')}
                      </p>
                    </div>
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Billing & Subscription */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
                <CreditCard className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-semibold text-white">{t('settings.billing.title')}</h2>
                <p className="text-xs sm:text-sm text-slate-400">{t('settings.billing.subtitle')}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {billing?.status === 'trial' && (
                <div className="rounded-full bg-yellow-500/10 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-yellow-400">
                  {t('settings.billing.trialDaysLeft', { days: billing.daysRemaining })}
                </div>
              )}
              {billing?.status === 'active' && (
                <div className="rounded-full bg-green-500/10 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-green-400">
                  {t('settings.billing.activeDaysRemaining', { days: billing.daysRemaining })}
                </div>
              )}
              {billing?.status === 'expired' && (
                <div className="rounded-full bg-red-500/10 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-red-400">
                  {t('settings.billing.expired')}
                </div>
              )}
            </div>
          </div>

          {/* Current Plan Status */}
          <div className="mb-4 sm:mb-6 rounded-xl border border-white/10 bg-navy-800/50 p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-xs sm:text-sm text-slate-400">{t('settings.billing.currentPlan')}</p>
                <p className="text-lg sm:text-xl font-bold text-white capitalize">
                  {billing?.plan || 'Loading...'}
                </p>
              </div>
              {billing?.limits && (
                <div className="flex gap-4">
                  <div className="text-right">
                    <p className="text-xs text-slate-400">{t('settings.billing.users')}</p>
                    <p className="text-sm sm:text-base font-semibold text-white">
                      {billing.limits.maxUsers === Infinity ? t('settings.billing.unlimited') : billing.limits.maxUsers}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400">{t('settings.billing.beneficiaries')}</p>
                    <p className="text-sm sm:text-base font-semibold text-white">
                      {billing.limits.maxBeneficiaries === Infinity ? t('settings.billing.unlimited') : billing.limits.maxBeneficiaries}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Available Plans */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.entries(PLANS) as [PlanKey, typeof PLANS[PlanKey]][]).map(([key, plan]) => {
              const Icon = plan.icon;
              const isCurrent = isCurrentPlan(key);
              const canSelectPlan = canUpgrade(key);
              
              return (
                <div
                  key={key}
                  className={`relative rounded-xl border p-4 ${
                    plan.popular
                      ? 'border-accent-500/50 bg-gradient-to-br from-accent-500/10 to-transparent'
                      : 'border-white/10 bg-navy-800/30'
                  }`}
                >
                  {plan.popular && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-accent-500 px-2 py-0.5 text-xs font-medium text-navy-950">
                      {t('settings.billing.popular')}
                    </span>
                  )}
                  
                  {isCurrent && (
                    <span className="absolute -top-2 right-3 rounded-full bg-green-500 px-2 py-0.5 text-xs font-medium text-navy-950">
                      {t('settings.billing.current')}
                    </span>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      plan.popular ? 'bg-accent-500/20 text-accent-400' : 'bg-navy-700 text-slate-400'
                    }`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                    <h3 className="font-semibold text-white">{t(`settings.billing.plans.${key}.name`)}</h3>
                    <p className="text-xs text-slate-400">{t(`settings.billing.plans.${key}.description`)}</p>
                    </div>
                  </div>

                  <div className="mb-3">
                    <span className="text-2xl font-bold text-white">{t(`settings.billing.plans.${key}.price`, { price: plan.price })}</span>
                  </div>

                  <ul className="space-y-1 mb-4 text-xs">
                    {plan.features.slice(0, 3).map((feature, idx) => {
                      const featureKey = getPlanFeatureKey(idx);
                      return (
                        <li key={idx} className="flex items-center gap-2 text-slate-300">
                          <Check className={`h-3 w-3 ${plan.popular ? 'text-accent-400' : 'text-green-400'}`} />
                          {t(`settings.billing.plans.${key}.features.${featureKey}`, { defaultValue: feature })}
                        </li>
                      );
                    })}
                  </ul>

                  {isCurrent ? (
                    <Button className="w-full" size="sm" disabled variant="secondary">
                      {t('settings.billing.currentPlan')}
                    </Button>
                  ) : canSelectPlan ? (
                    <Button
                      className="w-full"
                      size="sm"
                      variant={plan.popular ? 'default' : 'secondary'}
                      onClick={() => handleOpenPayment(key)}
                    >
                      {currentPlan === 'trial' ? t('settings.billing.subscribe') : t('settings.billing.upgrade')}
                    </Button>
                  ) : (
                    <Button className="w-full" size="sm" disabled variant="secondary">
                      {t('settings.billing.downgradeNA')}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Payment Info */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <p className="text-sm text-slate-400">
              {t('settings.billing.info')}
            </p>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-navy-900 p-4 sm:p-6 my-auto">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-xl font-bold text-white">
                {paymentStep === 'success' 
                  ? 'Payment Successful' 
                  : `Subscribe to ${PLANS[selectedPlan].name}`}
              </h2>
              <button
                onClick={handleClosePayment}
                className="text-slate-400 hover:text-white h-11 w-11 flex items-center justify-center"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Error Message */}
            {billingError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {billingError}
              </div>
            )}

            {paymentStep === 'select' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-white">{PLANS[selectedPlan].name} Plan</p>
                      <p className="text-sm text-slate-400">{PLANS[selectedPlan].description}</p>
                    </div>
                    <p className="text-2xl font-bold text-white">${PLANS[selectedPlan].price}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-300">
                    Payment Token
                  </label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setSelectedToken('USDC')}
                      className={`flex-1 rounded-lg border p-4 text-center transition-colors ${
                        selectedToken === 'USDC'
                          ? 'border-accent-500 bg-accent-500/10 text-white'
                          : 'border-white/10 text-slate-400 hover:border-white/30'
                      }`}
                    >
                      <p className="font-medium">USDC</p>
                      <p className="text-sm opacity-75">${PLANS[selectedPlan].price}</p>
                    </button>
                    <button
                      onClick={() => setSelectedToken('USDT')}
                      className={`flex-1 rounded-lg border p-4 text-center transition-colors ${
                        selectedToken === 'USDT'
                          ? 'border-accent-500 bg-accent-500/10 text-white'
                          : 'border-white/10 text-slate-400 hover:border-white/30'
                      }`}
                    >
                      <p className="font-medium">USDT</p>
                      <p className="text-sm opacity-75">${PLANS[selectedPlan].price}</p>
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-navy-800/50 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Platform Wallet</span>
                    <button
                      onClick={() => copyToClipboard(PLATFORM_WALLET)}
                      className="text-accent-400 hover:text-accent-300"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-1 font-mono text-sm text-white break-all">
                    {PLATFORM_WALLET}
                  </p>
                </div>

                <div className="pt-4 space-y-3">
                  <Button className="w-full" onClick={handlePayWithWallet}>
                    Pay with Connected Wallet
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => setPaymentStep('confirm')}
                  >
                    I've Already Paid (Enter TX Hash)
                  </Button>
                </div>
              </div>
            )}

            {paymentStep === 'pay' && (
              <div className="space-y-4 text-center">
                {isSending || isConfirming ? (
                  <>
                    <Loader2 className="mx-auto h-12 w-12 animate-spin text-accent-400" />
                    <p className="text-white">
                      {isSending ? 'Confirm transaction in your wallet...' : 'Waiting for confirmation...'}
                    </p>
                    <p className="text-sm text-slate-400">
                      Please don't close this window
                    </p>
                  </>
                ) : (
                  <>
                    <AlertCircle className="mx-auto h-12 w-12 text-yellow-400" />
                    <p className="text-white">Transaction pending</p>
                    <Button onClick={handlePayWithWallet}>
                      Retry Payment
                    </Button>
                  </>
                )}
              </div>
            )}

            {paymentStep === 'confirm' && (
              <div className="space-y-4">
                <p className="text-slate-400">
                  Enter the transaction hash of your payment to verify.
                </p>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Transaction Hash
                  </label>
                  <input
                    type="text"
                    value={manualTxHash}
                    onChange={(e) => setManualTxHash(e.target.value)}
                    placeholder="0x..."
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none"
                  />
                </div>

                <div className="rounded-lg border border-white/10 bg-navy-800/50 p-4">
                  <p className="text-sm text-slate-400">Expected payment:</p>
                  <p className="mt-1 font-medium text-white">
                    {PLANS[selectedPlan].price} {selectedToken} to
                  </p>
                  <p className="mt-1 font-mono text-sm text-slate-400 break-all">
                    {PLATFORM_WALLET}
                  </p>
                </div>

                <div className="flex gap-3">
                  <Button
                    className="flex-1"
                    onClick={() => handleConfirmPayment(manualTxHash)}
                    disabled={!manualTxHash.trim()}
                  >
                    Verify Payment
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setPaymentStep('select')}
                  >
                    Back
                  </Button>
                </div>
              </div>
            )}

            {paymentStep === 'success' && (
              <div className="space-y-4 text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-green-400" />
                <div>
                  <p className="text-xl font-medium text-white">
                    Welcome to {PLANS[selectedPlan].name}!
                  </p>
                  <p className="mt-2 text-slate-400">
                    Your subscription is now active. Enjoy all {PLANS[selectedPlan].name} features.
                  </p>
                </div>
                {txHash && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-accent-400 hover:underline"
                  >
                    View Transaction
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <Button className="w-full" onClick={handleClosePayment}>
                  Done
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
