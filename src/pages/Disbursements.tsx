import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Plus, Send, ArrowUpRight, Loader2, Play, CheckCircle } from 'lucide-react';
import {
  createTransferTx,
  proposeTransaction,
  executeTransaction,
} from '@/lib/safe';

export default function Disbursements() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const [isCreating, setIsCreating] = useState(false);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState('');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('USDC');
  const [memo, setMemo] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disbursements = useQuery(
    api.disbursements.list,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const beneficiaries = useQuery(
    api.beneficiaries.list,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address, activeOnly: true }
      : 'skip'
  );

  const safe = useQuery(
    api.safes.getForOrg,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const createDisbursement = useMutation(api.disbursements.create);
  const updateStatus = useMutation(api.disbursements.updateStatus);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !address || !selectedBeneficiary || !amount) return;

    try {
      await createDisbursement({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        beneficiaryId: selectedBeneficiary as Id<'beneficiaries'>,
        token,
        amount,
        memo: memo.trim() || undefined,
      });
      setSelectedBeneficiary('');
      setAmount('');
      setToken('USDC');
      setMemo('');
      setIsCreating(false);
    } catch (error) {
      console.error('Failed to create disbursement:', error);
    }
  };

  const handlePropose = async (disbursement: {
    _id: Id<'disbursements'>;
    beneficiary: { walletAddress: string } | null;
    token: string;
    amount: string;
  }) => {
    if (!safe || !address || !disbursement.beneficiary) return;

    setProcessingId(disbursement._id);
    setError(null);

    try {
      // Update status to pending
      await updateStatus({
        disbursementId: disbursement._id,
        walletAddress: address,
        status: 'pending',
      });

      // Create the transfer transaction
      const transferTx = createTransferTx(
        disbursement.token as 'USDC' | 'USDT',
        disbursement.beneficiary.walletAddress,
        disbursement.amount
      );

      // Propose to Safe
      const safeTxHash = await proposeTransaction(
        safe.safeAddress,
        address,
        [transferTx]
      );

      // Update status to proposed with safeTxHash
      await updateStatus({
        disbursementId: disbursement._id,
        walletAddress: address,
        status: 'proposed',
        safeTxHash,
      });
    } catch (err) {
      console.error('Failed to propose transaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to propose transaction');
      
      // Revert status to draft on failure
      await updateStatus({
        disbursementId: disbursement._id,
        walletAddress: address,
        status: 'draft',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleExecute = async (disbursement: {
    _id: Id<'disbursements'>;
    safeTxHash?: string;
  }) => {
    if (!safe || !address || !disbursement.safeTxHash) return;

    setProcessingId(disbursement._id);
    setError(null);

    try {
      // Execute the transaction
      const txHash = await executeTransaction(
        safe.safeAddress,
        address,
        disbursement.safeTxHash
      );

      // Update status to executed with txHash
      await updateStatus({
        disbursementId: disbursement._id,
        walletAddress: address,
        status: 'executed',
        txHash,
      });
    } catch (err) {
      console.error('Failed to execute transaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to execute transaction');
      
      // Mark as failed
      await updateStatus({
        disbursementId: disbursement._id,
        walletAddress: address,
        status: 'failed',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'executed':
        return 'bg-green-500/10 text-green-400';
      case 'failed':
      case 'cancelled':
        return 'bg-red-500/10 text-red-400';
      case 'pending':
      case 'proposed':
        return 'bg-yellow-500/10 text-yellow-400';
      default:
        return 'bg-slate-500/10 text-slate-400';
    }
  };

  const renderActionButton = (disbursement: typeof disbursements extends (infer T)[] | undefined ? T : never) => {
    const isProcessing = processingId === disbursement._id;

    if (isProcessing) {
      return (
        <Button variant="ghost" size="sm" disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
        </Button>
      );
    }

    switch (disbursement.status) {
      case 'draft':
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handlePropose(disbursement)}
            title="Propose to Safe"
          >
            <Play className="h-4 w-4 text-accent-400" />
          </Button>
        );
      case 'proposed':
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleExecute(disbursement)}
            title="Execute Transaction"
          >
            <CheckCircle className="h-4 w-4 text-green-400" />
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Disbursements</h1>
            <p className="mt-1 text-slate-400">
              Manage and track stablecoin payments
            </p>
          </div>
          <Button onClick={() => setIsCreating(true)} disabled={!safe}>
            <Plus className="h-4 w-4" />
            New Disbursement
          </Button>
        </div>

        {!safe && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-400">
            You need to link a Safe before creating disbursements. Go to Settings to link your Safe.
          </div>
        )}

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
        {isCreating && (
          <div className="rounded-2xl border border-accent-500/30 bg-navy-900/50 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">
              New Disbursement
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Beneficiary
                </label>
                <select
                  value={selectedBeneficiary}
                  onChange={(e) => setSelectedBeneficiary(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                >
                  <option value="">Select a beneficiary...</option>
                  {beneficiaries?.map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.name} ({b.walletAddress.slice(0, 6)}...{b.walletAddress.slice(-4)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Amount
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                    required
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Token
                  </label>
                  <select
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  >
                    <option value="USDC">USDC</option>
                    <option value="USDT">USDT</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Memo (optional)
                </label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Payment description..."
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>
              <div className="flex gap-3">
                <Button type="submit">Create Disbursement</Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsCreating(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Disbursements List */}
        {disbursements?.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/20 bg-navy-900/30 p-8 text-center">
            <Send className="mx-auto h-12 w-12 text-slate-500" />
            <h3 className="mt-4 text-lg font-medium text-white">
              No Disbursements Yet
            </h3>
            <p className="mt-2 text-slate-400">
              Create your first disbursement to send stablecoins
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-navy-900/50 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 bg-navy-800/50">
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">
                    Beneficiary
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">
                    Amount
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">
                    Memo
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">
                    Date
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-medium text-slate-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {disbursements?.map((disbursement) => (
                  <tr key={disbursement._id} className="hover:bg-navy-800/30">
                    <td className="px-6 py-4">
                      <p className="font-medium text-white">
                        {disbursement.beneficiary?.name || 'Unknown'}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-white">
                        {disbursement.amount} {disbursement.token}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {disbursement.memo || '-'}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium capitalize ${getStatusColor(
                          disbursement.status
                        )}`}
                      >
                        {disbursement.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {new Date(disbursement.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        {renderActionButton(disbursement)}
                        {disbursement.txHash && (
                          <a
                            href={`https://sepolia.etherscan.io/tx/${disbursement.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-accent-400 hover:underline"
                          >
                            <ArrowUpRight className="h-4 w-4" />
                          </a>
                        )}
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
