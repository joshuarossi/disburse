import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { 
  CreditCard, 
  Check, 
  X, 
  Copy, 
  ExternalLink,
  Loader2,
  CheckCircle,
  AlertCircle,
  User,
  Users,
  Building2,
} from 'lucide-react';
import { TOKENS } from '@/lib/wagmi';
import { encodeFunctionData, parseUnits } from 'viem';

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

export default function Billing() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('team');
  const [selectedToken, setSelectedToken] = useState<'USDC' | 'USDT'>('USDC');
  const [manualTxHash, setManualTxHash] = useState('');
  const [paymentStep, setPaymentStep] = useState<'select' | 'pay' | 'confirm' | 'success'>('select');
  const [error, setError] = useState<string | null>(null);

  const billing = useQuery(
    api.billing.get,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const subscribe = useMutation(api.billing.subscribe);

  // Transaction sending via wagmi
  const { data: txHash, sendTransaction, isPending: isSending } = useSendTransaction();

  // Wait for transaction receipt
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const handleOpenPayment = (plan: PlanKey) => {
    setSelectedPlan(plan);
    setShowPaymentModal(true);
    setPaymentStep('select');
    setError(null);
    setManualTxHash('');
  };

  const handleClosePayment = () => {
    setShowPaymentModal(false);
    setPaymentStep('select');
    setError(null);
    setManualTxHash('');
  };

  const handlePayWithWallet = async () => {
    if (!address) return;

    setError(null);
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
      setError(err instanceof Error ? err.message : 'Payment failed');
      setPaymentStep('select');
    }
  };

  const handleConfirmPayment = async (hash: string) => {
    if (!orgId || !address || !hash) return;

    setError(null);

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
      setError(err instanceof Error ? err.message : 'Failed to subscribe');
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
        <div>
          <h1 className="text-2xl font-bold text-white">Billing</h1>
          <p className="mt-1 text-slate-400">
            Manage your subscription and payment
          </p>
        </div>

        {/* Current Plan Status */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400">
                <CreditCard className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-slate-400">Current Plan</p>
                <p className="text-xl font-bold text-white capitalize">
                  {billing?.plan || 'Loading...'}
                </p>
              </div>
            </div>
            {billing?.status === 'trial' && (
              <div className="rounded-full bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-400">
                {billing.daysRemaining} days left in trial
              </div>
            )}
            {billing?.status === 'active' && (
              <div className="rounded-full bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400">
                Active - {billing.daysRemaining} days remaining
              </div>
            )}
            {billing?.status === 'expired' && (
              <div className="rounded-full bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400">
                Expired - Please renew
              </div>
            )}
          </div>

          {billing?.limits && (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg bg-navy-800/50 p-3">
                <p className="text-xs text-slate-400">Users</p>
                <p className="text-lg font-semibold text-white">
                  {billing.limits.maxUsers === Infinity ? 'Unlimited' : billing.limits.maxUsers}
                </p>
              </div>
              <div className="rounded-lg bg-navy-800/50 p-3">
                <p className="text-xs text-slate-400">Beneficiaries</p>
                <p className="text-lg font-semibold text-white">
                  {billing.limits.maxBeneficiaries === Infinity ? 'Unlimited' : billing.limits.maxBeneficiaries}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Pricing Tiers */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Available Plans</h2>
          <p className="text-slate-400 mb-6">
            Choose the plan that best fits your needs. All plans include a 30-day money-back guarantee.
          </p>
          
          <div className="grid gap-6 md:grid-cols-3">
            {(Object.entries(PLANS) as [PlanKey, typeof PLANS[PlanKey]][]).map(([key, plan]) => {
              const Icon = plan.icon;
              const isCurrent = isCurrentPlan(key);
              const canSelectPlan = canUpgrade(key);
              
              return (
                <div
                  key={key}
                  className={`relative rounded-2xl border p-6 ${
                    plan.popular
                      ? 'border-accent-500/50 bg-gradient-to-br from-accent-500/10 to-transparent'
                      : 'border-white/10 bg-navy-900/50'
                  }`}
                >
                  {plan.popular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-500 px-3 py-1 text-xs font-medium text-navy-950">
                      Most Popular
                    </span>
                  )}
                  
                  {isCurrent && (
                    <span className="absolute -top-3 right-4 rounded-full bg-green-500 px-3 py-1 text-xs font-medium text-navy-950">
                      Current Plan
                    </span>
                  )}

                  <div className="flex items-center gap-3 mb-4">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      plan.popular ? 'bg-accent-500/20 text-accent-400' : 'bg-navy-800 text-slate-400'
                    }`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                      <p className="text-sm text-slate-400">{plan.description}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <span className="text-3xl font-bold text-white">${plan.price}</span>
                    <span className="text-slate-400">/month</span>
                  </div>

                  <ul className="space-y-3 mb-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-3 text-sm text-slate-300">
                        <Check className={`h-4 w-4 ${plan.popular ? 'text-accent-400' : 'text-green-400'}`} />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <Button className="w-full" disabled variant="secondary">
                      Current Plan
                    </Button>
                  ) : canSelectPlan ? (
                    <Button
                      className="w-full"
                      variant={plan.popular ? 'default' : 'secondary'}
                      onClick={() => handleOpenPayment(key)}
                    >
                      {currentPlan === 'trial' ? 'Subscribe' : 'Upgrade'}
                    </Button>
                  ) : (
                    <Button className="w-full" disabled variant="secondary">
                      Downgrade not available
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Payment Info */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
          <h3 className="text-lg font-semibold text-white">Payment Information</h3>
          <p className="mt-1 text-slate-400">
            Pay for your subscription using stablecoins
          </p>
          
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-navy-800/50 p-4">
              <p className="text-sm text-slate-400">Accepted Tokens</p>
              <p className="mt-1 font-medium text-white">USDC, USDT</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-navy-800/50 p-4">
              <p className="text-sm text-slate-400">Network</p>
              <p className="mt-1 font-medium text-white">Ethereum (Sepolia)</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-navy-800/50 p-4">
              <p className="text-sm text-slate-400">Billing Cycle</p>
              <p className="mt-1 font-medium text-white">Monthly</p>
            </div>
          </div>
        </div>
      </div>

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
            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
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
