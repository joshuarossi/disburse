import { userErrorMessage } from '@/lib/userErrors';
import { useEffect, useState } from 'react';
import { Notice } from '@/components/workspace/WorkspacePrimitives';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Plus, Building2, ChevronRight, Mail } from 'lucide-react';
import { useSessionToken, clearSessionToken } from '@/lib/session';
import { teamRoles } from '../../shared/teamRoles';
import { formatDate } from '@/lib/formatMoney';

export default function SelectOrg() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { address } = useAccount();
  const token = useSessionToken();
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState('');
  useEffect(() => {
    if (!address || !token) {
      clearSessionToken();
      navigate('/login', { replace: true });
    }
  }, [address, token, navigate]);

  // Token-based identity: lists active memberships AND pending invites
  const orgs = useQuery(
    api.orgs.listForUser,
    address && token ? { sessionToken: token } : 'skip',
  );

  const acceptInvite = useMutation(api.orgs.acceptInvite);
  const licenseAccess = useQuery(api.licenseAdmin.access, token && address ? { sessionToken: token } : 'skip');

  const handleSelectOrg = (orgId: string | Id<'orgs'>) => {
    navigate(`/org/${orgId}/dashboard`);
  };

  const handleAcceptInvite = async (orgId: Id<'orgs'>) => {
    if (!token || accepting) return;
    setAccepting(orgId);
    setError('');
    try {
      await acceptInvite({ orgId, sessionToken: token });
    } catch (error) {
      setError(
        userErrorMessage(error, 'Could not accept invitation'),
      );
    } finally {
      setAccepting('');
    }
  };

  if (!address || !token) {
    return null;
  }

  return (
    <div className="workspace workspace-entry flex min-h-screen flex-col items-center justify-center bg-[var(--ws-bg)] px-6 py-12">
      {/* Background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--ws-accent-soft)] blur-[120px]" />
      </div>

      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-400">
              <Building2 className="h-6 w-6 text-navy-950" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[var(--ws-text)]">
            {t('auth.selectOrg.title')}
          </h1>
          <p className="mt-2 text-[var(--ws-muted)]">{t('auth.selectOrg.subtitle')}</p>
        </div>

        {error && <Notice>{error}</Notice>}
        {/* Org List */}
        <div className="space-y-3">
          {orgs
            ?.filter((o): o is NonNullable<typeof o> => !!o)
            .map((org) =>
              org.membershipStatus === 'invited' ? (
                // Pending invite — must be accepted before access is granted
                <div
                  key={org._id}
                  className="flex w-full items-center justify-between rounded-xl border border-[var(--ws-accent)]/20 bg-[var(--ws-surface)] p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--ws-subtle)] text-[var(--ws-muted)]">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-[var(--ws-text)]">{org.name}</p>
                      <p className="text-sm text-[var(--ws-accent)]">
                        {org.invitationAvailable === false ? 'Invitation unavailable' : 'Invitation pending'} · {teamRoles[org.role][0]}
                      </p>
                      {org.invitationAvailable === false ? <p className="text-xs text-[var(--ws-muted)]">Ask an administrator for a new invitation.</p> : org.invitationExpiresAt && <p className="text-xs text-[var(--ws-muted)]">Expires {formatDate(org.invitationExpiresAt)}</p>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={!!accepting || org.invitationAvailable === false}
                    onClick={() => handleAcceptInvite(org._id)}
                  >
                    Accept
                  </Button>
                </div>
              ) : (
                <button
                  key={org._id}
                  onClick={() => handleSelectOrg(org._id)}
                  className="group flex w-full items-center justify-between rounded-xl border border-[var(--ws-border)] bg-[var(--ws-surface)] p-4 text-left transition-all hover:border-[var(--ws-accent)]/30 hover:bg-[var(--ws-subtle)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--ws-subtle)] text-[var(--ws-muted)] group-hover:bg-accent-500/20 group-hover:text-[var(--ws-accent)]">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-[var(--ws-text)]">{org.name}</p>
                      <p className="text-sm text-[var(--ws-muted)] capitalize">
                        {teamRoles[org.role][0]}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-[var(--ws-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--ws-accent)]" />
                </button>
              ),
            )}

          {orgs?.length === 0 && (
            <p className="text-center text-[var(--ws-muted)] py-4">
              {t('auth.selectOrg.noOrgs')}
            </p>
          )}
        </div>

        {/* Create New Org — routes to the onboarding wizard */}
        <Button
          onClick={() => navigate('/onboarding')}
          variant="secondary"
          className="mt-6 w-full"
        >
          <Plus className="h-4 w-4" />
          {t('auth.selectOrg.createNew')}
        </Button>
        {licenseAccess?.allowed && <Button variant="secondary" className="mt-3 w-full" onClick={() => navigate('/admin/licenses')}>Manage company licenses</Button>}
      </div>
    </div>
  );
}
