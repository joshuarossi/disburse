import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Users, Plus, Trash2, Loader2, AlertCircle, Edit, X } from 'lucide-react';

type Role = 'admin' | 'approver' | 'initiator' | 'clerk' | 'viewer';

interface EditingMember {
  membershipId: string;
  name: string;
  email: string;
  role: Role;
  walletAddress: string;
  isCurrentUser: boolean;
}

export default function Team() {
  const { orgId } = useParams<{ orgId: string }>();
  const { address } = useAccount();
  const { t } = useTranslation();

  const ROLES = [
    { value: 'admin' as const, label: t('settings.team.roles.admin'), description: t('settings.team.roles.adminDesc') },
    { value: 'approver' as const, label: t('settings.team.roles.approver'), description: t('settings.team.roles.approverDesc') },
    { value: 'initiator' as const, label: t('settings.team.roles.initiator'), description: t('settings.team.roles.initiatorDesc') },
    { value: 'clerk' as const, label: t('settings.team.roles.clerk'), description: t('settings.team.roles.clerkDesc') },
    { value: 'viewer' as const, label: t('settings.team.roles.viewer'), description: t('settings.team.roles.viewerDesc') },
  ] as const;

  const [isAddingMember, setIsAddingMember] = useState(false);
  const [newMemberAddress, setNewMemberAddress] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<Role>('viewer');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [processingMemberId, setProcessingMemberId] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<EditingMember | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<{
    membershipId: string;
    name?: string;
    walletAddress: string;
  } | null>(null);

  const members = useQuery(
    api.orgs.listMembers,
    orgId && address
      ? { orgId: orgId as Id<'orgs'>, walletAddress: address }
      : 'skip'
  );

  const currentUserRole = members?.find(
    (m) => m?.walletAddress.toLowerCase() === address?.toLowerCase()
  )?.role;
  const isAdmin = currentUserRole === 'admin';

  const inviteMember = useMutation(api.orgs.inviteMember);
  const updateMemberRole = useMutation(api.orgs.updateMemberRole);
  const updateMemberName = useMutation(api.orgs.updateMemberName);
  const updateMemberEmail = useMutation(api.orgs.updateMemberEmail);
  const removeMember = useMutation(api.orgs.removeMember);

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
      const originalMember = members?.find(m => m?.membershipId === editingMember.membershipId);

      if (originalMember?.name !== editingMember.name) {
        await updateMemberName({
          orgId: orgId as Id<'orgs'>,
          membershipId: editingMember.membershipId as Id<'orgMemberships'>,
          walletAddress: address,
          name: editingMember.name.trim() || undefined,
        });
      }

      if (originalMember?.email !== editingMember.email) {
        await updateMemberEmail({
          orgId: orgId as Id<'orgs'>,
          membershipId: editingMember.membershipId as Id<'orgMemberships'>,
          walletAddress: address,
          email: editingMember.email.trim() || undefined,
        });
      }

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

  const handleOpenRemoveMember = (member: {
    membershipId: string;
    name?: string;
    walletAddress: string;
  }) => {
    setMemberToRemove({
      membershipId: member.membershipId,
      name: member.name,
      walletAddress: member.walletAddress,
    });
    setMemberError(null);
  };

  const handleCloseRemoveMember = () => {
    setMemberToRemove(null);
  };

  const handleRemoveMember = async () => {
    if (!memberToRemove || !orgId || !address) return;

    setProcessingMemberId(memberToRemove.membershipId);
    try {
      await removeMember({
        orgId: orgId as Id<'orgs'>,
        membershipId: memberToRemove.membershipId as Id<'orgMemberships'>,
        walletAddress: address,
      });
      handleCloseRemoveMember();
    } catch (error) {
      console.error('Failed to remove member:', error);
      setMemberError(error instanceof Error ? error.message : 'Failed to remove member');
    } finally {
      setProcessingMemberId(null);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-4 sm:space-y-6 lg:space-y-8 w-full max-w-full overflow-x-hidden">
        <div className="pt-4 lg:pt-6">
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('settings.team.title')}</h1>
          <p className="mt-1 text-sm sm:text-base text-slate-400">
            {t('settings.team.subtitle')}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 shrink-0">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-semibold text-white">{t('settings.team.title')}</h2>
                <p className="text-xs sm:text-sm text-slate-400">{t('settings.team.subtitle')}</p>
              </div>
            </div>
            {isAdmin && (
              <Button onClick={() => setIsAddingMember(true)} className="w-full sm:w-auto h-11 shrink-0">
                <Plus className="h-4 w-4" />
                {t('settings.team.addMember')}
              </Button>
            )}
          </div>

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

          {isAddingMember && (
            <form onSubmit={handleInviteMember} className="mb-6 rounded-xl border border-accent-500/30 bg-navy-800/50 p-4">
              <h3 className="mb-4 font-medium text-white">{t('settings.team.addTeamMember')}</h3>
              <div className="space-y-4 sm:space-y-6">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    {t('common.walletAddress')}
                  </label>
                  <input
                    type="text"
                    value={newMemberAddress}
                    onChange={(e) => setNewMemberAddress(e.target.value)}
                    placeholder="0x..."
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 font-mono text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
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
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
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
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    {t('settings.team.role')}
                  </label>
                  <select
                    value={newMemberRole}
                    onChange={(e) => setNewMemberRole(e.target.value as Role)}
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  >
                    {ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label} - {role.description}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button type="submit" className="w-full sm:w-auto h-11">{t('settings.team.addMember')}</Button>
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
                    className="w-full sm:w-auto h-11"
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            </form>
          )}

          {members?.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/20 bg-navy-800/30 p-8 text-center">
              <p className="text-slate-400">{t('settings.team.noMembers')}</p>
            </div>
          ) : (
            <>
              <div className="hidden lg:block rounded-xl border border-white/10 overflow-hidden">
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
                                  onClick={() => handleOpenRemoveMember(member)}
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

              <div className="lg:hidden space-y-3">
                {members?.filter((m) => m?.status === 'active').map((member) => {
                  if (!member) return null;
                  const isCurrentUser = member.walletAddress.toLowerCase() === address?.toLowerCase();
                  const isProcessing = processingMemberId === member.membershipId;
                  const canEdit = isAdmin || isCurrentUser;

                  return (
                    <div
                      key={member.membershipId}
                      className="rounded-lg border border-white/10 bg-navy-800/50 p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
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
                          <p className="font-mono text-xs text-slate-500 mt-1 break-all">
                            {member.walletAddress}
                          </p>
                          {member.email && (
                            <p className="text-sm text-slate-500 mt-1">{member.email}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full bg-navy-700 px-2.5 py-1 text-xs font-medium text-slate-300 capitalize">
                          {member.role}
                        </span>
                        <span className="inline-flex rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400 capitalize">
                          {member.status}
                        </span>
                      </div>

                      {(canEdit || (isAdmin && !isCurrentUser)) && (
                        <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenEditMember(member)}
                              className="flex-1 h-11"
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              {t('settings.team.editMember')}
                            </Button>
                          )}
                          {isAdmin && !isCurrentUser && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenRemoveMember(member)}
                              disabled={isProcessing}
                              className="flex-1 h-11 text-red-400 hover:text-red-300"
                            >
                              {isProcessing ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  {t('common.removing')}
                                </>
                              ) : (
                                <>
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  {t('settings.team.remove')}
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-navy-900 p-4 sm:p-6 my-auto">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-xl font-bold text-white">{t('settings.team.editMember')}</h2>
              <button
                onClick={handleCloseEditMember}
                className="text-slate-400 hover:text-white h-11 w-11 flex items-center justify-center"
                aria-label="Close"
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

            <form onSubmit={handleSaveEditMember} className="space-y-4 sm:space-y-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  {t('common.walletAddress')}
                </label>
                <p className="font-mono text-sm text-slate-400 break-all">
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
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
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
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
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
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-3 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
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

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  type="submit"
                  className="flex-1 h-11"
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
                <Button type="button" variant="secondary" onClick={handleCloseEditMember} className="h-11">
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {memberToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-navy-900 p-4 sm:p-6 my-auto">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-xl font-bold text-white">{t('settings.team.removeMemberTitle')}</h2>
              <button
                onClick={handleCloseRemoveMember}
                className="text-slate-400 hover:text-white h-11 w-11 flex items-center justify-center"
                aria-label="Close"
                disabled={processingMemberId === memberToRemove.membershipId}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mb-4 text-sm text-slate-400">
              {t('settings.team.removeConfirm')}
            </p>
            <div className="rounded-lg border border-white/10 bg-navy-800/50 p-4 mb-6">
              <p className="font-medium text-white">
                {memberToRemove.name || t('settings.team.noName')}
              </p>
              <p className="font-mono text-xs text-slate-500 mt-1 break-all">
                {memberToRemove.walletAddress}
              </p>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={handleCloseRemoveMember}
                className="h-11"
                disabled={processingMemberId === memberToRemove.membershipId}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                className="flex-1 h-11 bg-red-600 hover:bg-red-500 text-white"
                onClick={handleRemoveMember}
                disabled={processingMemberId === memberToRemove.membershipId}
              >
                {processingMemberId === memberToRemove.membershipId ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t('common.removing')}
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('settings.team.removeFromTeam')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
