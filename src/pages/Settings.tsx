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
import { 
  Wallet, 
  Building2, 
  Users, 
  ArrowUpRight, 
  Plus, 
  Trash2,
  Loader2,
  Save,
  AlertCircle,
  Edit,
  X,
  CreditCard,
  Check,
  Copy,
  ExternalLink,
  CheckCircle,
  User,
} from 'lucide-react';
import { validateSafeAddress, isOwner } from '@/lib/safe';
import { TOKENS } from '@/lib/wagmi';
import { encodeFunctionData, parseUnits } from 'viem';

const SEPOLIA_CHAIN_ID = 11155111;

// ROLES will be translated in component

type Role = typeof ROLES[number]['value'];

// Platform wallet address for receiving payments (Sepolia testnet)
const PLATFORM_WALLET = '0x742d35Cc6634C0532925a3b844Bc9e7595f7aa22' as const;

// Plan configurations
const PLANS = {
  starter: {
    name: 'Starter',
    price: 25,
    description: 'For individuals',
    icon: User,
    features: [
      '1 user',
      '1 Safe',
      '25 beneficiaries',
      'One-time disbursements',
      'Audit logs',
      'CSV export',
    ],
    limits: {
      users: 1,
      beneficiaries: 25,
    },
  },
  team: {
    name: 'Team',
    price: 50,
    description: 'For small teams',
    icon: Users,
    popular: true,
    features: [
      '5 users',
      '1 Safe',
      '100 beneficiaries',
      'All 5 roles',
      'Multi-sig approval',
      'Everything in Starter',
    ],
    limits: {
      users: 5,
      beneficiaries: 100,
    },
  },
  pro: {
    name: 'Pro',
    price: 99,
    description: 'For growing teams',
    icon: Building2,
    features: [
      'Unlimited users',
      '1 Safe',
      'Unlimited beneficiaries',
      'Professional reports',
      'Priority support',
      'Everything in Team',
    ],
    limits: {
      users: Infinity,
      beneficiaries: Infinity,
    },
  },
} as const;

type PlanKey = keyof typeof PLANS;

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

interface EditingMember {
  membershipId: string;
  name: string;
  email: string;
  role: Role;
  walletAddress: string;
  isCurrentUser: boolean;
}

export default function Settings() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();
  
  const ROLES = [
    { value: 'admin', label: t('settings.team.roles.admin'), description: t('settings.team.roles.adminDesc') },
    { value: 'approver', label: t('settings.team.roles.approver'), description: t('settings.team.roles.approverDesc') },
    { value: 'initiator', label: t('settings.team.roles.initiator'), description: t('settings.team.roles.initiatorDesc') },
    { value: 'clerk', label: t('settings.team.roles.clerk'), description: t('settings.team.roles.clerkDesc') },
    { value: 'viewer', label: t('settings.team.roles.viewer'), description: t('settings.team.roles.viewerDesc') },
  ] as const;
  
  // Organization state
  const [orgName, setOrgName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  
  // Safe state
  const [safeAddress, setSafeAddress] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [linkingError, setLinkingError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  
  // Team member state
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [newMemberAddress, setNewMemberAddress] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<Role>('viewer');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [processingMemberId, setProcessingMemberId] = useState<string | null>(null);
  
  // Edit member modal state
  const [editingMember, setEditingMember] = useState<EditingMember | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Billing state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('team');
  const [selectedToken, setSelectedToken] = useState<'USDC' | 'USDT'>('USDC');
  const [manualTxHash, setManualTxHash] = useState('');
  const [paymentStep, setPaymentStep] = useState<'select' | 'pay' | 'confirm' | 'success'>('select');
  const [billingError, setBillingError] = useState<string | null>(null);

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

  const safe = useQuery(
    api.safes.getForOrg,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

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
  const inviteMember = useMutation(api.orgs.inviteMember);
  const updateMemberRole = useMutation(api.orgs.updateMemberRole);
  const updateMemberName = useMutation(api.orgs.updateMemberName);
  const updateMemberEmail = useMutation(api.orgs.updateMemberEmail);
  const removeMember = useMutation(api.orgs.removeMember);
  const subscribe = useMutation(api.billing.subscribe);

  // Initialize org name when loaded
  if (org?.name && !orgName && !isEditingName) {
    setOrgName(org.name);
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

  const handleLinkSafe = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[Settings] handleLinkSafe called', { orgId, address, safeAddress: safeAddress.trim() });
    if (!orgId || !address || !safeAddress.trim()) {
      console.log('[Settings] Early return - missing data', { orgId, address, safeAddress });
      return;
    }

    setIsValidating(true);
    setLinkingError(null);

    try {
      // Validate the Safe address
      console.log('[Settings] Calling validateSafeAddress...');
      const isValid = await validateSafeAddress(safeAddress.trim());
      console.log('[Settings] validateSafeAddress returned:', isValid);
      if (!isValid) {
        setLinkingError('Invalid Safe address. Please check the address and network.');
        setIsValidating(false);
        return;
      }

      // Check if user is an owner
      const userIsOwner = await isOwner(safeAddress.trim(), address);
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
        chainId: SEPOLIA_CHAIN_ID,
      });
      setSafeAddress('');
      setIsLinking(false);
    } catch (error) {
      console.error('Failed to link safe:', error);
      setLinkingError(error instanceof Error ? error.message : 'Failed to link Safe');
      setIsValidating(false);
    }
  };

  const handleUnlinkSafe = async () => {
    if (!safe || !address) return;
    if (!confirm(t('settings.safe.unlinkConfirm'))) return;

    try {
      await unlinkSafe({
        safeId: safe._id,
        walletAddress: address,
      });
    } catch (error) {
      console.error('Failed to unlink safe:', error);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !address || !newMemberAddress.trim()) return;

    setMemberError(null);

    try {
      await inviteMember({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        memberWalletAddress: newMemberAddress.trim(),
        memberName: newMemberName.trim() || undefined,
        memberEmail: newMemberEmail.trim() || undefined,
        role: newMemberRole,
      });
      setNewMemberAddress('');
      setNewMemberName('');
      setNewMemberEmail('');
      setNewMemberRole('viewer');
      setIsAddingMember(false);
    } catch (error) {
      console.error('Failed to invite member:', error);
      setMemberError(error instanceof Error ? error.message : 'Failed to invite member');
    }
  };

  // Modal handlers for editing team members
  const handleOpenEditMember = (member: {
    membershipId: string;
    name?: string;
    email?: string;
    role: Role;
    walletAddress: string;
  }) => {
    const isCurrentUser = member.walletAddress.toLowerCase() === address?.toLowerCase();
    setEditingMember({
      membershipId: member.membershipId,
      name: member.name || '',
      email: member.email || '',
      role: member.role,
      walletAddress: member.walletAddress,
      isCurrentUser,
    });
    setEditError(null);
  };

  const handleCloseEditMember = () => {
    setEditingMember(null);
    setEditError(null);
  };

  const handleSaveEditMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember || !orgId || !address) return;

    setEditError(null);
    setProcessingMemberId(editingMember.membershipId);

    try {
      // Get the original member data
      const originalMember = members?.find(m => m?.membershipId === editingMember.membershipId);
      
      // Update name if changed
      if (originalMember?.name !== editingMember.name) {
        await updateMemberName({
          orgId: orgId as Id<'orgs'>,
          membershipId: editingMember.membershipId as Id<'orgMemberships'>,
          walletAddress: address,
          name: editingMember.name.trim() || undefined,
        });
      }

      // Update email if changed
      if (originalMember?.email !== editingMember.email) {
        await updateMemberEmail({
          orgId: orgId as Id<'orgs'>,
          membershipId: editingMember.membershipId as Id<'orgMemberships'>,
          walletAddress: address,
          email: editingMember.email.trim() || undefined,
        });
      }

      // Update role if changed and user is admin (and not editing themselves)
      if (isAdmin && !editingMember.isCurrentUser && originalMember?.role !== editingMember.role) {
        await updateMemberRole({
          orgId: orgId as Id<'orgs'>,
          membershipId: editingMember.membershipId as Id<'orgMemberships'>,
          walletAddress: address,
          newRole: editingMember.role,
        });
      }

      setEditingMember(null);
    } catch (error) {
      console.error('Failed to update member:', error);
      setEditError(error instanceof Error ? error.message : 'Failed to update member');
    } finally {
      setProcessingMemberId(null);
    }
  };

  const handleRemoveMember = async (membershipId: string) => {
    if (!orgId || !address) return;
    if (!confirm(t('settings.team.removeConfirm'))) return;

    setProcessingMemberId(membershipId);
    try {
      await removeMember({
        orgId: orgId as Id<'orgs'>,
        membershipId: membershipId as Id<'orgMemberships'>,
        walletAddress: address,
      });
    } catch (error) {
      console.error('Failed to remove member:', error);
      setMemberError(error instanceof Error ? error.message : 'Failed to remove member');
    } finally {
      setProcessingMemberId(null);
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

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('settings.title')}</h1>
            <p className="mt-1 text-slate-400">
              {t('settings.subtitle')}
            </p>
          </div>
          <LanguageSwitcher />
        </div>

        {/* Organization Info */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{t('settings.organization.title')}</h2>
              <p className="text-sm text-slate-400">{t('settings.organization.subtitle')}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('settings.organization.orgName')}
                </label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                    setIsEditingName(true);
                  }}
                  disabled={!isAdmin}
                  className="flex-1 rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white disabled:opacity-50"
                />
                {isAdmin && isEditingName && (
                  <Button onClick={handleSaveOrgName} disabled={savingName}>
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
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{t('settings.safe.title')}</h2>
              <p className="text-sm text-slate-400">{t('settings.safe.subtitle')}</p>
            </div>
          </div>

          {safe ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-navy-800/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">{t('settings.safe.connected')}</p>
                    <p className="mt-1 font-mono text-white">{safe.safeAddress}</p>
                  </div>
                  <a
                    href={`https://app.safe.global/sep:${safe.safeAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-accent-400 hover:underline"
                  >
                    {t('settings.safe.openSafe')}
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                    {t('settings.safe.network')}
                  </span>
                </div>
              </div>
              {isAdmin && (
                <Button variant="secondary" onClick={handleUnlinkSafe}>
                  {t('settings.safe.unlinkSafe')}
                </Button>
              )}
            </div>
          ) : isLinking ? (
            <form onSubmit={handleLinkSafe} className="space-y-4">
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
                  placeholder={t('settings.safe.safeAddressPlaceholder')}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 font-mono text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
                <p className="mt-2 text-sm text-slate-500">
                  {t('settings.safe.safeAddressDescription')}
                </p>
              </div>
              
              {linkingError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {linkingError}
                </div>
              )}
              
              <div className="flex gap-3">
                <Button type="submit" disabled={isValidating}>
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
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="text-center py-6">
              <Wallet className="mx-auto h-12 w-12 text-slate-500" />
              <p className="mt-4 text-slate-400">{t('settings.safe.noSafe')}</p>
              {isAdmin && (
                <Button className="mt-4" onClick={() => setIsLinking(true)}>
                  {t('settings.safe.linkExisting')}
                </Button>
              )}
              <p className="mt-4 text-sm text-slate-500">
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
          )}
        </div>

        {/* Team Members */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">{t('settings.team.title')}</h2>
                <p className="text-sm text-slate-400">{t('settings.team.subtitle')}</p>
              </div>
            </div>
            {isAdmin && (
              <Button onClick={() => setIsAddingMember(true)}>
                <Plus className="h-4 w-4" />
                {t('settings.team.addMember')}
              </Button>
            )}
          </div>

          {/* Error Message */}
          {memberError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {memberError}
              <button
                onClick={() => setMemberError(null)}
                className="ml-auto text-red-300 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Add Member Form */}
          {isAddingMember && (
            <form onSubmit={handleInviteMember} className="mb-6 rounded-xl border border-accent-500/30 bg-navy-800/50 p-4">
              <h3 className="mb-4 font-medium text-white">{t('settings.team.addTeamMember')}</h3>
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    {t('common.walletAddress')}
                  </label>
                  <input
                    type="text"
                    value={newMemberAddress}
                    onChange={(e) => setNewMemberAddress(e.target.value)}
                    placeholder="0x..."
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 font-mono text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                    required
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    {t('settings.team.displayName')} <span className="text-slate-500">({t('common.optional')})</span>
                  </label>
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder={t('settings.team.displayNamePlaceholder')}
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    {t('common.email')} <span className="text-slate-500">({t('common.optional')})</span>
                  </label>
                  <input
                    type="email"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder={t('settings.team.emailPlaceholder')}
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    {t('settings.team.role')}
                  </label>
                  <select
                    value={newMemberRole}
                    onChange={(e) => setNewMemberRole(e.target.value as Role)}
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  >
                    {ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label} - {role.description}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3">
                  <Button type="submit">{t('settings.team.addMember')}</Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setIsAddingMember(false);
                      setNewMemberAddress('');
                      setNewMemberName('');
                      setNewMemberEmail('');
                      setNewMemberRole('viewer');
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            </form>
          )}

          {/* Members List */}
          {members?.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/20 bg-navy-800/30 p-8 text-center">
              <p className="text-slate-400">{t('settings.team.noMembers')}</p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 bg-navy-800/50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">
                      {t('settings.team.member')}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">
                      {t('settings.team.role')}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">
                      {t('settings.team.status')}
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-slate-400">
                      {t('settings.team.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {members?.filter((m) => m?.status === 'active').map((member) => {
                    if (!member) return null;
                    const isCurrentUser = member.walletAddress.toLowerCase() === address?.toLowerCase();
                    const isProcessing = processingMemberId === member.membershipId;
                    const canEdit = isAdmin || isCurrentUser;

                    return (
                      <tr key={member.membershipId} className="hover:bg-navy-800/30">
                        <td className="px-4 py-3">
                          <div>
                            {member.name ? (
                              <p className="font-medium text-white">
                                {member.name}
                                {isCurrentUser && (
                                  <span className="ml-2 text-xs text-accent-400">({t('settings.team.you')})</span>
                                )}
                              </p>
                            ) : (
                              <p className="text-sm text-slate-500 italic">
                                {t('settings.team.noName')}
                                {isCurrentUser && (
                                  <span className="ml-1 text-xs text-accent-400 not-italic">({t('settings.team.you')})</span>
                                )}
                              </p>
                            )}
                            <p className="font-mono text-xs text-slate-500">
                              {member.walletAddress.slice(0, 6)}...{member.walletAddress.slice(-4)}
                            </p>
                            {member.email && (
                              <p className="text-sm text-slate-500">{member.email}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-navy-700 px-3 py-1 text-xs font-medium text-slate-300 capitalize">
                            {member.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400 capitalize">
                            {member.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenEditMember(member)}
                                title="Edit member"
                              >
                                <Edit className="h-4 w-4 text-slate-400" />
                              </Button>
                            )}
                            {isAdmin && !isCurrentUser && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveMember(member.membershipId)}
                                disabled={isProcessing}
                                title="Remove member"
                              >
                                {isProcessing ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4 text-red-400" />
                                )}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Billing & Subscription */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">{t('settings.billing.title')}</h2>
                <p className="text-sm text-slate-400">{t('settings.billing.subtitle')}</p>
              </div>
            </div>
            {billing?.status === 'trial' && (
              <div className="rounded-full bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-400">
                {t('settings.billing.trialDaysLeft', { days: billing.daysRemaining })}
              </div>
            )}
            {billing?.status === 'active' && (
              <div className="rounded-full bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400">
                {t('settings.billing.activeDaysRemaining', { days: billing.daysRemaining })}
              </div>
            )}
            {billing?.status === 'expired' && (
              <div className="rounded-full bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400">
                {t('settings.billing.expired')}
              </div>
            )}
          </div>

          {/* Current Plan Status */}
          <div className="mb-6 rounded-xl border border-white/10 bg-navy-800/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">{t('settings.billing.currentPlan')}</p>
                <p className="text-xl font-bold text-white capitalize">
                  {billing?.plan || 'Loading...'}
                </p>
              </div>
              {billing?.limits && (
                <div className="flex gap-4">
                  <div className="text-right">
                    <p className="text-xs text-slate-400">{t('settings.billing.users')}</p>
                    <p className="font-semibold text-white">
                      {billing.limits.maxUsers === Infinity ? t('settings.billing.unlimited') : billing.limits.maxUsers}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400">{t('settings.billing.beneficiaries')}</p>
                    <p className="font-semibold text-white">
                      {billing.limits.maxBeneficiaries === Infinity ? t('settings.billing.unlimited') : billing.limits.maxBeneficiaries}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Available Plans */}
          <div className="grid gap-4 md:grid-cols-3">
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
                      const featureKeys = ['users', 'safe', 'beneficiaries', 'disbursements', 'audit', 'export', 'roles', 'multisig', 'everything', 'reports', 'support'];
                      const featureKey = featureKeys[idx] || `feature${idx}`;
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

      {/* Edit Member Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-navy-900 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">{t('settings.team.editMember')}</h2>
              <button
                onClick={handleCloseEditMember}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {editError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEditMember} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('common.walletAddress')}
                </label>
                <p className="font-mono text-sm text-slate-400">
                  {editingMember.walletAddress}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('settings.team.displayName')}
                </label>
                <input
                  type="text"
                  value={editingMember.name}
                  onChange={(e) => setEditingMember({ ...editingMember, name: e.target.value })}
                  placeholder={t('settings.team.displayNamePlaceholder')}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('common.email')}
                </label>
                <input
                  type="email"
                  value={editingMember.email}
                  onChange={(e) => setEditingMember({ ...editingMember, email: e.target.value })}
                  placeholder={t('settings.team.emailPlaceholder')}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('settings.team.role')}
                </label>
                {isAdmin && !editingMember.isCurrentUser ? (
                  <select
                    value={editingMember.role}
                    onChange={(e) => setEditingMember({ ...editingMember, role: e.target.value as Role })}
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  >
                    {ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label} - {role.description}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-slate-400 capitalize">
                    {editingMember.role}
                    {editingMember.isCurrentUser && (
                      <span className="ml-2 text-xs text-slate-500">({t('settings.team.cannotChangeRole')})</span>
                    )}
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <Button 
                  type="submit" 
                  className="flex-1"
                  disabled={processingMemberId === editingMember.membershipId}
                >
                  {processingMemberId === editingMember.membershipId ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('common.saving')}
                    </>
                  ) : (
                    t('beneficiaries.saveChanges')
                  )}
                </Button>
                <Button type="button" variant="secondary" onClick={handleCloseEditMember}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-navy-900 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">
                {paymentStep === 'success' 
                  ? 'Payment Successful' 
                  : `Subscribe to ${PLANS[selectedPlan].name}`}
              </h2>
              <button
                onClick={handleClosePayment}
                className="text-slate-400 hover:text-white"
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
