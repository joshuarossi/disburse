import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
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
} from 'lucide-react';
import { validateSafeAddress, isOwner } from '@/lib/safe';

const SEPOLIA_CHAIN_ID = 11155111;

const ROLES = [
  { value: 'admin', label: 'Admin', description: 'Full access to all features' },
  { value: 'approver', label: 'Approver', description: 'Can approve disbursements' },
  { value: 'initiator', label: 'Initiator', description: 'Can create disbursements' },
  { value: 'clerk', label: 'Clerk', description: 'Can manage beneficiaries' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access' },
] as const;

type Role = typeof ROLES[number]['value'];

export default function Settings() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  
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
  const [newMemberRole, setNewMemberRole] = useState<Role>('viewer');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [processingMemberId, setProcessingMemberId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');

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
  const removeMember = useMutation(api.orgs.removeMember);

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
        role: newMemberRole,
      });
      setNewMemberAddress('');
      setNewMemberName('');
      setNewMemberRole('viewer');
      setIsAddingMember(false);
    } catch (error) {
      console.error('Failed to invite member:', error);
      setMemberError(error instanceof Error ? error.message : 'Failed to invite member');
    }
  };

  const handleStartEditName = (membershipId: string, currentName?: string) => {
    setEditingNameId(membershipId);
    setEditingNameValue(currentName || '');
  };

  const handleSaveName = async (membershipId: string) => {
    if (!orgId || !address) return;

    setProcessingMemberId(membershipId);
    try {
      await updateMemberName({
        orgId: orgId as Id<'orgs'>,
        membershipId: membershipId as Id<'orgMemberships'>,
        walletAddress: address,
        name: editingNameValue.trim() || undefined,
      });
      setEditingNameId(null);
      setEditingNameValue('');
    } catch (error) {
      console.error('Failed to update name:', error);
      setMemberError(error instanceof Error ? error.message : 'Failed to update name');
    } finally {
      setProcessingMemberId(null);
    }
  };

  const handleCancelEditName = () => {
    setEditingNameId(null);
    setEditingNameValue('');
  };

  const handleUpdateRole = async (membershipId: string, newRole: Role) => {
    if (!orgId || !address) return;

    setProcessingMemberId(membershipId);
    try {
      await updateMemberRole({
        orgId: orgId as Id<'orgs'>,
        membershipId: membershipId as Id<'orgMemberships'>,
        walletAddress: address,
        newRole,
      });
    } catch (error) {
      console.error('Failed to update role:', error);
      setMemberError(error instanceof Error ? error.message : 'Failed to update role');
    } finally {
      setProcessingMemberId(null);
    }
  };

  const handleRemoveMember = async (membershipId: string) => {
    if (!orgId || !address) return;
    if (!confirm('Are you sure you want to remove this member?')) return;

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
                    Save
                  </Button>
                )}
              </div>
              {!isAdmin && (
                <p className="mt-2 text-sm text-slate-500">
                  Only admins can edit the organization name
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
              {isAdmin && (
                <Button variant="secondary" onClick={handleUnlinkSafe}>
                  Unlink Safe
                </Button>
              )}
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
                  onChange={(e) => {
                    setSafeAddress(e.target.value);
                    setLinkingError(null);
                  }}
                  placeholder="0x..."
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 font-mono text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  required
                />
                <p className="mt-2 text-sm text-slate-500">
                  Enter the address of your existing Gnosis Safe on Sepolia testnet
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
                      Validating...
                    </>
                  ) : (
                    'Link Safe'
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
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="text-center py-6">
              <Wallet className="mx-auto h-12 w-12 text-slate-500" />
              <p className="mt-4 text-slate-400">No Safe connected yet</p>
              {isAdmin && (
                <Button className="mt-4" onClick={() => setIsLinking(true)}>
                  Link Existing Safe
                </Button>
              )}
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

        {/* Team Members */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Team Members</h2>
                <p className="text-sm text-slate-400">Manage access to your organization</p>
              </div>
            </div>
            {isAdmin && (
              <Button onClick={() => setIsAddingMember(true)}>
                <Plus className="h-4 w-4" />
                Add Member
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
              <h3 className="mb-4 font-medium text-white">Add Team Member</h3>
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Wallet Address
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
                    Display Name <span className="text-slate-500">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder="e.g., John Doe"
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Role
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
                  <Button type="submit">Add Member</Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setIsAddingMember(false);
                      setNewMemberAddress('');
                      setNewMemberName('');
                      setNewMemberRole('viewer');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </form>
          )}

          {/* Members List */}
          {members?.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/20 bg-navy-800/30 p-8 text-center">
              <p className="text-slate-400">No team members yet</p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 bg-navy-800/50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">
                      Member
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">
                      Role
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">
                      Status
                    </th>
                    {isAdmin && (
                      <th className="px-4 py-3 text-right text-sm font-medium text-slate-400">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {members?.filter((m) => m?.status === 'active').map((member) => {
                    if (!member) return null;
                    const isCurrentUser = member.walletAddress.toLowerCase() === address?.toLowerCase();
                    const isProcessing = processingMemberId === member.membershipId;
                    const isEditingName = editingNameId === member.membershipId;
                    const canEditName = isAdmin || isCurrentUser;

                    return (
                      <tr key={member.membershipId} className="hover:bg-navy-800/30">
                        <td className="px-4 py-3">
                          <div>
                            {isEditingName ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editingNameValue}
                                  onChange={(e) => setEditingNameValue(e.target.value)}
                                  placeholder="Display name..."
                                  className="rounded border border-white/10 bg-navy-800 px-2 py-1 text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none w-32"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      handleSaveName(member.membershipId);
                                    } else if (e.key === 'Escape') {
                                      handleCancelEditName();
                                    }
                                  }}
                                />
                                <button
                                  onClick={() => handleSaveName(member.membershipId)}
                                  disabled={isProcessing}
                                  className="text-green-400 hover:text-green-300 text-xs"
                                >
                                  {isProcessing ? '...' : 'Save'}
                                </button>
                                <button
                                  onClick={handleCancelEditName}
                                  className="text-slate-400 hover:text-white text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <>
                                {member.name ? (
                                  <p className="font-medium text-white">
                                    {member.name}
                                    {isCurrentUser && (
                                      <span className="ml-2 text-xs text-accent-400">(you)</span>
                                    )}
                                    {canEditName && (
                                      <button
                                        onClick={() => handleStartEditName(member.membershipId, member.name)}
                                        className="ml-2 text-xs text-slate-500 hover:text-accent-400"
                                      >
                                        edit
                                      </button>
                                    )}
                                  </p>
                                ) : (
                                  <p className="text-sm text-slate-500 italic">
                                    No name
                                    {canEditName && (
                                      <button
                                        onClick={() => handleStartEditName(member.membershipId, '')}
                                        className="ml-2 text-xs text-slate-400 hover:text-accent-400 not-italic"
                                      >
                                        + add
                                      </button>
                                    )}
                                    {isCurrentUser && (
                                      <span className="ml-1 text-xs text-accent-400 not-italic">(you)</span>
                                    )}
                                  </p>
                                )}
                                <p className="font-mono text-xs text-slate-500">
                                  {member.walletAddress.slice(0, 6)}...{member.walletAddress.slice(-4)}
                                </p>
                              </>
                            )}
                            {member.email && (
                              <p className="text-sm text-slate-500">{member.email}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {isAdmin && !isCurrentUser ? (
                            <select
                              value={member.role}
                              onChange={(e) => handleUpdateRole(member.membershipId, e.target.value as Role)}
                              disabled={isProcessing}
                              className="rounded-lg border border-white/10 bg-navy-800 px-3 py-1 text-sm text-white focus:border-accent-500 focus:outline-none disabled:opacity-50"
                            >
                              {ROLES.map((role) => (
                                <option key={role.value} value={role.value}>
                                  {role.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="inline-flex rounded-full bg-navy-700 px-3 py-1 text-xs font-medium text-slate-300 capitalize">
                              {member.role}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400 capitalize">
                            {member.status}
                          </span>
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-right">
                            {!isCurrentUser && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveMember(member.membershipId)}
                                disabled={isProcessing}
                              >
                                {isProcessing ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4 text-red-400" />
                                )}
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
