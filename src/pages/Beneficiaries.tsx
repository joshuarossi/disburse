import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Plus, Users, MoreVertical, Edit, Trash2 } from 'lucide-react';

export default function Beneficiaries() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const beneficiaries = useQuery(
    api.beneficiaries.list,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const createBeneficiary = useMutation(api.beneficiaries.create);
  const updateBeneficiary = useMutation(api.beneficiaries.update);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !address || !newName.trim() || !newAddress.trim()) return;

    try {
      await createBeneficiary({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        name: newName.trim(),
        beneficiaryAddress: newAddress.trim(),
        notes: newNotes.trim() || undefined,
      });
      setNewName('');
      setNewAddress('');
      setNewNotes('');
      setIsCreating(false);
    } catch (error) {
      console.error('Failed to create beneficiary:', error);
    }
  };

  const handleToggleActive = async (beneficiaryId: Id<'beneficiaries'>, isActive: boolean) => {
    if (!address) return;
    try {
      await updateBeneficiary({
        beneficiaryId,
        walletAddress: address,
        isActive: !isActive,
      });
    } catch (error) {
      console.error('Failed to update beneficiary:', error);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Beneficiaries</h1>
            <p className="mt-1 text-slate-400">
              Manage your payment recipients
            </p>
          </div>
          <Button onClick={() => setIsCreating(true)}>
            <Plus className="h-4 w-4" />
            Add Beneficiary
          </Button>
        </div>

        {/* Create Form */}
        {isCreating && (
          <div className="rounded-2xl border border-accent-500/30 bg-navy-900/50 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">
              New Beneficiary
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., John Doe"
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Wallet Address
                </label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 font-mono text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Notes (optional)
                </label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Any additional notes..."
                  rows={2}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>
              <div className="flex gap-3">
                <Button type="submit">Create Beneficiary</Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setIsCreating(false);
                    setNewName('');
                    setNewAddress('');
                    setNewNotes('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Beneficiaries List */}
        {beneficiaries?.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/20 bg-navy-900/30 p-8 text-center">
            <Users className="mx-auto h-12 w-12 text-slate-500" />
            <h3 className="mt-4 text-lg font-medium text-white">
              No Beneficiaries Yet
            </h3>
            <p className="mt-2 text-slate-400">
              Add your first beneficiary to start making disbursements
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-navy-900/50 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 bg-navy-800/50">
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">
                    Name
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">
                    Wallet Address
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">
                    Status
                  </th>
                  <th className="px-6 py-4 text-right text-sm font-medium text-slate-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {beneficiaries?.map((beneficiary) => (
                  <tr key={beneficiary._id} className="hover:bg-navy-800/30">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-white">{beneficiary.name}</p>
                        {beneficiary.notes && (
                          <p className="text-sm text-slate-500">{beneficiary.notes}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-sm text-slate-400">
                        {beneficiary.walletAddress.slice(0, 6)}...
                        {beneficiary.walletAddress.slice(-4)}
                      </code>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                          beneficiary.isActive
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-slate-500/10 text-slate-400'
                        }`}
                      >
                        {beneficiary.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            handleToggleActive(beneficiary._id, beneficiary.isActive)
                          }
                        >
                          {beneficiary.isActive ? (
                            <Trash2 className="h-4 w-4 text-slate-400" />
                          ) : (
                            <Edit className="h-4 w-4 text-slate-400" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
