import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Plus, Building2, ChevronRight } from 'lucide-react';

export default function SelectOrg() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { address } = useAccount();

  const orgs = useQuery(
    api.orgs.listForUser,
    address ? { walletAddress: address } : 'skip'
  );

  const handleSelectOrg = (orgId: string) => {
    navigate(`/org/${orgId}/dashboard`);
  };

  if (!address) {
    navigate('/login');
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-navy-950 px-6">
      {/* Background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-500/10 blur-[120px]" />
      </div>

      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-400">
              <Building2 className="h-6 w-6 text-navy-950" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white">{t('auth.selectOrg.title')}</h1>
          <p className="mt-2 text-slate-400">
            {t('auth.selectOrg.subtitle')}
          </p>
        </div>

        {/* Org List */}
        <div className="space-y-3">
          {orgs?.filter((o): o is NonNullable<typeof o> => !!o).map((org) => (
            <button
              key={org._id}
              onClick={() => handleSelectOrg(org._id)}
              className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-navy-900/50 p-4 text-left transition-all hover:border-accent-500/30 hover:bg-navy-800/50"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-slate-400 group-hover:bg-accent-500/20 group-hover:text-accent-400">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-white">{org.name}</p>
                  <p className="text-sm text-slate-500 capitalize">{org.role}</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-500 transition-transform group-hover:translate-x-1 group-hover:text-accent-400" />
            </button>
          ))}

          {orgs?.length === 0 && (
            <p className="text-center text-slate-500 py-4">
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
      </div>
    </div>
  );
}
