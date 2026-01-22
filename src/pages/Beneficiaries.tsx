import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { 
  Plus, 
  Users, 
  Edit, 
  Trash2, 
  User, 
  Building2,
  X,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

type BeneficiaryType = 'individual' | 'business';

interface EditingBeneficiary {
  id: Id<'beneficiaries'>;
  type: BeneficiaryType;
  name: string;
  walletAddress: string;
  notes: string;
}

export default function Beneficiaries() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  
  // Create form state
  const [isCreating, setIsCreating] = useState(false);
  const [newType, setNewType] = useState<BeneficiaryType>('individual');
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  
  // Edit modal state
  const [editingBeneficiary, setEditingBeneficiary] = useState<EditingBeneficiary | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

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

    setCreateError(null);
    
    try {
      await createBeneficiary({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        type: newType,
        name: newName.trim(),
        beneficiaryAddress: newAddress.trim(),
        notes: newNotes.trim() || undefined,
      });
      setNewType('individual');
      setNewName('');
      setNewAddress('');
      setNewNotes('');
      setIsCreating(false);
    } catch (error) {
      console.error('Failed to create beneficiary:', error);
      setCreateError(error instanceof Error ? error.message : 'Failed to create beneficiary');
    }
  };

  const handleOpenEdit = (beneficiary: {
    _id: Id<'beneficiaries'>;
    type?: BeneficiaryType;
    name: string;
    walletAddress: string;
    notes?: string;
  }) => {
    setEditingBeneficiary({
      id: beneficiary._id,
      type: beneficiary.type || 'individual',
      name: beneficiary.name,
      walletAddress: beneficiary.walletAddress,
      notes: beneficiary.notes || '',
    });
    setEditError(null);
  };

  const handleCloseEdit = () => {
    setEditingBeneficiary(null);
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBeneficiary || !address) return;

    setEditError(null);

    try {
      await updateBeneficiary({
        beneficiaryId: editingBeneficiary.id,
        walletAddress: address,
        type: editingBeneficiary.type,
        name: editingBeneficiary.name.trim(),
        beneficiaryAddress: editingBeneficiary.walletAddress.trim(),
        notes: editingBeneficiary.notes.trim() || undefined,
      });
      setEditingBeneficiary(null);
    } catch (error) {
      console.error('Failed to update beneficiary:', error);
      setEditError(error instanceof Error ? error.message : 'Failed to update beneficiary');
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
            
            {createError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {createError}
              </div>
            )}
            
            <form onSubmit={handleCreate} className="space-y-4">
              {/* Type Selector */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Beneficiary Type
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setNewType('individual')}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border p-4 transition-colors ${
                      newType === 'individual'
                        ? 'border-accent-500 bg-accent-500/10 text-white'
                        : 'border-white/10 text-slate-400 hover:border-white/30'
                    }`}
                  >
                    <User className="h-5 w-5" />
                    <span className="font-medium">Individual</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewType('business')}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border p-4 transition-colors ${
                      newType === 'business'
                        ? 'border-accent-500 bg-accent-500/10 text-white'
                        : 'border-white/10 text-slate-400 hover:border-white/30'
                    }`}
                  >
                    <Building2 className="h-5 w-5" />
                    <span className="font-medium">Business</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {newType === 'individual' ? 'Full Name' : 'Business Name'}
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={newType === 'individual' ? 'e.g., John Doe' : 'e.g., Acme Corporation'}
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
                    setNewType('individual');
                    setNewName('');
                    setNewAddress('');
                    setNewNotes('');
                    setCreateError(null);
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
                    Type
                  </th>
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
                      <div className="flex items-center gap-2">
                        {beneficiary.type === 'business' ? (
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                            <Building2 className="h-4 w-4" />
                          </div>
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                            <User className="h-4 w-4" />
                          </div>
                        )}
                        <span className="text-sm text-slate-400 capitalize">
                          {beneficiary.type || 'Individual'}
                        </span>
                      </div>
                    </td>
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
                          onClick={() => handleOpenEdit(beneficiary)}
                          title="Edit beneficiary"
                        >
                          <Edit className="h-4 w-4 text-slate-400" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleToggleActive(beneficiary._id, beneficiary.isActive)}
                          title={beneficiary.isActive ? 'Deactivate' : 'Reactivate'}
                        >
                          {beneficiary.isActive ? (
                            <Trash2 className="h-4 w-4 text-red-400" />
                          ) : (
                            <RefreshCw className="h-4 w-4 text-green-400" />
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

      {/* Edit Modal */}
      {editingBeneficiary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-navy-900 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Edit Beneficiary</h2>
              <button
                onClick={handleCloseEdit}
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

            <form onSubmit={handleSaveEdit} className="space-y-4">
              {/* Type Selector */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Beneficiary Type
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingBeneficiary({ ...editingBeneficiary, type: 'individual' })}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border p-3 transition-colors ${
                      editingBeneficiary.type === 'individual'
                        ? 'border-accent-500 bg-accent-500/10 text-white'
                        : 'border-white/10 text-slate-400 hover:border-white/30'
                    }`}
                  >
                    <User className="h-4 w-4" />
                    <span className="text-sm font-medium">Individual</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingBeneficiary({ ...editingBeneficiary, type: 'business' })}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border p-3 transition-colors ${
                      editingBeneficiary.type === 'business'
                        ? 'border-accent-500 bg-accent-500/10 text-white'
                        : 'border-white/10 text-slate-400 hover:border-white/30'
                    }`}
                  >
                    <Building2 className="h-4 w-4" />
                    <span className="text-sm font-medium">Business</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {editingBeneficiary.type === 'individual' ? 'Full Name' : 'Business Name'}
                </label>
                <input
                  type="text"
                  value={editingBeneficiary.name}
                  onChange={(e) => setEditingBeneficiary({ ...editingBeneficiary, name: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Wallet Address
                </label>
                <input
                  type="text"
                  value={editingBeneficiary.walletAddress}
                  onChange={(e) => setEditingBeneficiary({ ...editingBeneficiary, walletAddress: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 font-mono text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Notes (optional)
                </label>
                <textarea
                  value={editingBeneficiary.notes}
                  onChange={(e) => setEditingBeneficiary({ ...editingBeneficiary, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" className="flex-1">
                  Save Changes
                </Button>
                <Button type="button" variant="secondary" onClick={handleCloseEdit}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
