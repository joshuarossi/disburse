import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { CreditCard, Check, Sparkles } from 'lucide-react';

export default function Billing() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();

  const billing = useQuery(
    api.billing.get,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

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

        {/* Current Plan */}
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
                Active
              </div>
            )}
          </div>

          {billing?.status === 'trial' && (
            <div className="mt-6 rounded-xl border border-accent-500/30 bg-accent-500/5 p-4">
              <div className="flex items-center gap-2 text-accent-400">
                <Sparkles className="h-5 w-5" />
                <p className="font-medium">Upgrade to Pro</p>
              </div>
              <p className="mt-2 text-sm text-slate-400">
                Continue using Disburse after your trial ends. Pay with stablecoins.
              </p>
              <Button className="mt-4">
                Upgrade Now
              </Button>
            </div>
          )}
        </div>

        {/* Plan Features */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Trial/Current Plan */}
          <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
            <h3 className="text-lg font-semibold text-white">
              {billing?.plan === 'trial' ? 'Trial' : 'Your Plan'}
            </h3>
            <p className="mt-1 text-slate-400">What's included</p>
            
            <ul className="mt-6 space-y-3">
              {[
                'Unlimited beneficiaries',
                'Unlimited disbursements',
                'Full audit trail',
                'Single-signer payments',
                'USDC & USDT support',
                'Email notifications',
              ].map((feature) => (
                <li key={feature} className="flex items-center gap-3 text-slate-300">
                  <Check className="h-5 w-5 text-accent-400" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          {/* Pro Plan */}
          <div className="rounded-2xl border border-accent-500/30 bg-gradient-to-br from-accent-500/10 to-transparent p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Pro</h3>
              <span className="rounded-full bg-accent-500/20 px-3 py-1 text-xs font-medium text-accent-400">
                Coming Soon
              </span>
            </div>
            <p className="mt-1 text-slate-400">For growing teams</p>
            
            <div className="mt-6">
              <span className="text-3xl font-bold text-white">$99</span>
              <span className="text-slate-400">/month</span>
            </div>

            <ul className="mt-6 space-y-3">
              {[
                'Everything in Trial',
                'Multi-sig support',
                'Team roles & permissions',
                'Priority support',
                'Custom integrations',
                'API access',
              ].map((feature) => (
                <li key={feature} className="flex items-center gap-3 text-slate-300">
                  <Check className="h-5 w-5 text-accent-400" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button className="mt-6 w-full" disabled>
              Contact Sales
            </Button>
          </div>
        </div>

        {/* Payment Info */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
          <h3 className="text-lg font-semibold text-white">Payment</h3>
          <p className="mt-1 text-slate-400">
            Pay for your subscription using stablecoins
          </p>
          
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-navy-800/50 p-4">
              <p className="text-sm text-slate-400">Accepted Tokens</p>
              <p className="mt-1 font-medium text-white">USDC, USDT</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-navy-800/50 p-4">
              <p className="text-sm text-slate-400">Network</p>
              <p className="mt-1 font-medium text-white">Ethereum (Sepolia)</p>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
