import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Settings as SettingsIcon, Wallet, Building2, Users, ArrowUpRight } from 'lucide-react';

const SEPOLIA_CHAIN_ID = 11155111;

export default function Settings() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const [safeAddress, setSafeAddress] = useState('');
  const [isLinking, setIsLinking] = useState(false);

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

  const linkSafe = useMutation(api.safes.link);
  const unlinkSafe = useMutation(api.safes.unlink);

  const handleLinkSafe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !address || !safeAddress.trim()) return;

    try {
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
    }
  };

  const handleUnlinkSafe = async () => {
    if (!safe || !address) return;
    if (!confirm('Are you sure you want to unlink this Safe?')) return;

    try {
      await unlinkSafe({
        safeId: safe._id,
        walletAddress: address,
      });
    } catch (error) {
      console.error('Failed to unlink safe:', error);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="mt-1 text-slate-400">
            Manage your organization settings
          </p>
        </div>

        {/* Organization Info */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Organization</h2>
              <p className="text-sm text-slate-400">General settings</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Organization Name
              </label>
              <input
                type="text"
                value={org?.name || ''}
                readOnly
                className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white"
              />
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
              <h2 className="text-lg font-semibold text-white">Safe Wallet</h2>
              <p className="text-sm text-slate-400">Connect your Gnosis Safe</p>
            </div>
          </div>

          {safe ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-navy-800/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">Connected Safe</p>
                    <p className="mt-1 font-mono text-white">{safe.safeAddress}</p>
                  </div>
                  <a
                    href={`https://app.safe.global/sep:${safe.safeAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-accent-400 hover:underline"
                  >
                    Open Safe
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                    Sepolia
                  </span>
                </div>
              </div>
              <Button variant="secondary" onClick={handleUnlinkSafe}>
                Unlink Safe
              </Button>
            </div>
          ) : isLinking ? (
            <form onSubmit={handleLinkSafe} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Safe Address (Sepolia)
                </label>
                <input
                  type="text"
                  value={safeAddress}
                  onChange={(e) => setSafeAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 font-mono text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
                <p className="mt-2 text-sm text-slate-500">
                  Enter the address of your existing Gnosis Safe on Sepolia testnet
                </p>
              </div>
              <div className="flex gap-3">
                <Button type="submit">Link Safe</Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsLinking(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="text-center py-6">
              <Wallet className="mx-auto h-12 w-12 text-slate-500" />
              <p className="mt-4 text-slate-400">No Safe connected yet</p>
              <Button className="mt-4" onClick={() => setIsLinking(true)}>
                Link Existing Safe
              </Button>
              <p className="mt-4 text-sm text-slate-500">
                Don't have a Safe?{' '}
                <a
                  href="https://app.safe.global/new-safe/create"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-400 hover:underline"
                >
                  Create one here
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Team Members - Placeholder */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Team Members</h2>
              <p className="text-sm text-slate-400">Manage access to your organization</p>
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-white/20 bg-navy-800/30 p-8 text-center">
            <p className="text-slate-400">Team management coming soon</p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
