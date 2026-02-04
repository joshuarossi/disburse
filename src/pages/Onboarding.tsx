import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { createSafe, validateSafeAddress, isOwner } from '@/lib/safe';
import { CHAINS_LIST } from '@/lib/chains';
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  Check,
  Shield,
  Users,
  Building2,
  User,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Role = 'admin' | 'approver' | 'initiator' | 'clerk' | 'viewer';
type Step = 'profile' | 'create-org' | 'team' | 'safe';

const STEPS: Step[] = ['profile', 'create-org', 'team', 'safe'];

interface TeamMember {
  walletAddress: string;
  name: string;
  email: string;
  role: Role;
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------
export default function Onboarding() {
  const navigate = useNavigate();
  const { address, chain } = useAccount();

  // ---- profile state ----
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // ---- org state ----
  const [orgName, setOrgName] = useState('');
  const [orgId, setOrgId] = useState<string | null>(null);

  // ---- team state ----
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [newMember, setNewMember] = useState<TeamMember>({ walletAddress: '', name: '', email: '', role: 'approver' });
  const [isAddingMember, setIsAddingMember] = useState(false);

  // ---- safe state ----
  const [hasSafe, setHasSafe] = useState<boolean | null>(null); // null = not yet chosen
  const [existingSafeAddress, setExistingSafeAddress] = useState('');
  const [selectedChainId, setSelectedChainId] = useState(chain?.id ?? 1);
  const [safeThreshold, setSafeThreshold] = useState(1);
  const [deploying, setDeploying] = useState(false);
  const [deployedTxHash, setDeployedTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [safeError, setSafeError] = useState<string | null>(null);
  const [linkingExisting, setLinkingExisting] = useState(false);

  // ---- nav state ----
  const [step, setStep] = useState<Step>('profile');
  const [orgError, setOrgError] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);

  // ---- mutations ----
  const createOrg = useMutation(api.orgs.create);
  const updateOwnProfile = useMutation(api.orgs.updateOwnProfile);
  const inviteMember = useMutation(api.orgs.inviteMember);
  const linkSafe = useMutation(api.safes.link);

  // ---- wagmi tx helpers ----
  const { sendTransactionAsync } = useSendTransaction();
  useWaitForTransactionReceipt({
    hash: deployedTxHash,
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const stepIndex = STEPS.indexOf(step);
  const canGoBack = stepIndex > 0;

  const goBack = () => {
    if (canGoBack) setStep(STEPS[stepIndex - 1]);
  };

  // --- Org → next (creates org, persists profile name/email, advances) ---
  const handleCreateOrg = async () => {
    if (!address || !orgName.trim()) return;
    setOrgError(null);

    try {
      const { orgId: newOrgId } = await createOrg({
        name: orgName.trim(),
        walletAddress: address,
      });
      setOrgId(newOrgId);

      // Persist the profile name/email collected in step 1 onto the creator's membership
      if (name.trim() || email.trim()) {
        await updateOwnProfile({
          orgId: newOrgId,
          walletAddress: address,
          name: name.trim() || undefined,
          email: email.trim() || undefined,
        });
      }

      setStep('team');
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : 'Failed to create organization');
    }
  };

  // --- Team: add a member to the local list ---
  const handleAddMember = () => {
    if (!newMember.walletAddress.trim()) return;
    setTeamError(null);

    if (newMember.walletAddress.toLowerCase() === address?.toLowerCase()) {
      setTeamError("You're already a member of this organization.");
      return;
    }
    if (teamMembers.some((m) => m.walletAddress.toLowerCase() === newMember.walletAddress.toLowerCase())) {
      setTeamError('This wallet is already in the list.');
      return;
    }

    setTeamMembers((prev) => [...prev, { ...newMember, walletAddress: newMember.walletAddress.trim() }]);
    setNewMember({ walletAddress: '', name: '', email: '', role: 'approver' });
    setIsAddingMember(false);
  };

  const handleRemoveMember = (idx: number) => {
    setTeamMembers((prev) => prev.filter((_, i) => i !== idx));
  };

  // --- Team → next (persists members, advances) ---
  const handleTeamNext = async () => {
    if (!orgId || !address) return;
    setTeamError(null);

    try {
      // Persist all team members
      for (const member of teamMembers) {
        await inviteMember({
          orgId: orgId as Id<'orgs'>,
          walletAddress: address,
          memberWalletAddress: member.walletAddress,
          memberName: member.name || undefined,
          memberEmail: member.email || undefined,
          role: member.role,
        });
      }
      setStep('safe');
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : 'Failed to add team members');
    }
  };

  // --- Safe: link an existing safe ---
  const handleLinkExisting = async () => {
    if (!orgId || !address || !existingSafeAddress.trim()) return;
    setSafeError(null);
    setLinkingExisting(true);

    try {
      const valid = await validateSafeAddress(existingSafeAddress.trim(), selectedChainId);
      if (!valid) {
        setSafeError('No Safe found at that address on the selected chain.');
        return;
      }
      const isOwnerResult = await isOwner(existingSafeAddress.trim(), address, selectedChainId);
      if (!isOwnerResult) {
        setSafeError('Your connected wallet is not an owner of that Safe.');
        return;
      }

      await linkSafe({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        safeAddress: existingSafeAddress.trim(),
        chainId: selectedChainId,
      });

      // Done — go to dashboard
      navigate(`/org/${orgId}/dashboard`);
    } catch (err) {
      setSafeError(err instanceof Error ? err.message : 'Failed to link Safe');
    } finally {
      setLinkingExisting(false);
    }
  };

  // --- Safe: deploy a new safe ---
  const handleCreateNewSafe = async () => {
    if (!orgId || !address) return;
    setSafeError(null);
    setDeploying(true);

    try {
      // Owners = connected wallet + any team members added (wallet addresses)
      const owners = [address, ...teamMembers.map((m) => m.walletAddress)];
      const threshold = Math.min(safeThreshold, owners.length);

      const { predictedAddress, deployTx } = await createSafe(owners, threshold);

      // Send the deploy transaction — MetaMask will prompt
      const txHash = await sendTransactionAsync({
        to: deployTx.to as `0x${string}`,
        data: deployTx.data as `0x${string}`,
        value: deployTx.value,
      });

      setDeployedTxHash(txHash);

      // Link immediately — address is deterministic via CREATE2
      await linkSafe({
        orgId: orgId as Id<'orgs'>,
        walletAddress: address,
        safeAddress: predictedAddress,
        chainId: selectedChainId,
      });

      // Navigate to dashboard
      navigate(`/org/${orgId}/dashboard`);
    } catch (err) {
      setSafeError(err instanceof Error ? err.message : 'Failed to deploy Safe');
    } finally {
      setDeploying(false);
    }
  };

  const handleProfileAndAdvance = () => {
    setStep('create-org');
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const StepBadge = ({ s, label, icon: Icon }: { s: Step; label: string; icon: typeof User }) => {
    const idx = STEPS.indexOf(s);
    const currentIdx = STEPS.indexOf(step);
    const done = idx < currentIdx;
    const active = idx === currentIdx;

    return (
      <div className={`flex items-center gap-2 ${idx > 0 ? 'ml-auto' : ''}`}>
        {idx > 0 && (
          <div className={`h-px w-6 ${done ? 'bg-accent-500' : 'bg-white/10'}`} />
        )}
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
            done
              ? 'border-accent-500 bg-accent-500'
              : active
              ? 'border-accent-500 bg-navy-800'
              : 'border-white/10 bg-navy-800'
          }`}
        >
          {done ? (
            <Check className="h-4 w-4 text-navy-950" />
          ) : (
            <Icon className={`h-4 w-4 ${active ? 'text-accent-400' : 'text-slate-500'}`} />
          )}
        </div>
        <span className={`text-xs font-medium ${active ? 'text-white' : done ? 'text-accent-400' : 'text-slate-500'}`}>
          {label}
        </span>
      </div>
    );
  };

  const stepIcons: Record<Step, typeof User> = {
    profile: User,
    'create-org': Building2,
    team: Users,
    safe: Shield,
  };

  const stepLabels: Record<Step, string> = {
    profile: 'Profile',
    'create-org': 'Organization',
    team: 'Team',
    safe: 'Safe Wallet',
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-navy-950 px-6">
      {/* Background glow */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-500/10 blur-[120px]" />
      </div>

      <div className="w-full max-w-lg">
        {/* Progress bar */}
        <div className="mb-8 flex items-center justify-between">
          {STEPS.map((s) => (
            <StepBadge key={s} s={s} label={stepLabels[s]} icon={stepIcons[s]} />
          ))}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-navy-900/50 p-8">

          {/* ================================================================
              STEP: PROFILE
              ============================================================== */}
          {step === 'profile' && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-white">Welcome to Disburse</h1>
                <p className="mt-2 text-slate-400">
                  Tell us a bit about yourself. Both fields are optional — you can always update later.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2.5 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2.5 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button onClick={handleProfileAndAdvance} className="flex-1">
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ================================================================
              STEP: CREATE ORG
              ============================================================== */}
          {step === 'create-org' && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-white">Create your organization</h1>
                <p className="mt-2 text-slate-400">
                  Your organization is the workspace where you manage disbursements and team members.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">Organization name</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  autoFocus
                  className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2.5 text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>

              {orgError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-400">{orgError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="secondary" onClick={goBack} className="w-12 shrink-0">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button onClick={handleCreateOrg} disabled={!orgName.trim()} className="flex-1">
                  Create organization
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ================================================================
              STEP: TEAM
              ============================================================== */}
          {step === 'team' && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-white">Add team members</h1>
                <p className="mt-2 text-slate-400">
                  Invite people to your organization. You can always add more later. This step is optional.
                </p>
              </div>

              {/* Existing members list */}
              {teamMembers.length > 0 && (
                <div className="space-y-2">
                  {teamMembers.map((m, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-navy-800 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white font-mono">
                          {m.walletAddress.slice(0, 8)}...{m.walletAddress.slice(-4)}
                        </p>
                        <p className="text-xs text-slate-500 capitalize">
                          {m.name || 'No name'} · {m.role}
                        </p>
                      </div>
                      <button onClick={() => handleRemoveMember(idx)} className="text-slate-500 hover:text-red-400 transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add member form */}
              {isAddingMember ? (
                <div className="rounded-lg border border-accent-500/30 bg-navy-800/50 p-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">Wallet address *</label>
                    <input
                      type="text"
                      value={newMember.walletAddress}
                      onChange={(e) => setNewMember((prev) => ({ ...prev, walletAddress: e.target.value }))}
                      placeholder="0x..."
                      autoFocus
                      className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-400">Name</label>
                      <input
                        type="text"
                        value={newMember.name}
                        onChange={(e) => setNewMember((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="Name"
                        className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-400">Email</label>
                      <input
                        type="email"
                        value={newMember.email}
                        onChange={(e) => setNewMember((prev) => ({ ...prev, email: e.target.value }))}
                        placeholder="Email"
                        className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">Role</label>
                    <select
                      value={newMember.role}
                      onChange={(e) => setNewMember((prev) => ({ ...prev, role: e.target.value as Role }))}
                      className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                    >
                      <option value="approver">Approver</option>
                      <option value="initiator">Initiator</option>
                      <option value="clerk">Clerk</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={handleAddMember} disabled={!newMember.walletAddress.trim()} className="flex-1">
                      Add
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setIsAddingMember(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setIsAddingMember(true)} className="w-full">
                  <Plus className="h-4 w-4" />
                  Add a team member
                </Button>
              )}

              {teamError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-400">{teamError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="secondary" onClick={goBack} className="w-12 shrink-0">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button onClick={handleTeamNext} className="flex-1">
                  {teamMembers.length === 0 ? 'Skip for now' : 'Continue'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ================================================================
              STEP: SAFE
              ============================================================== */}
          {step === 'safe' && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-white">Set up your Safe wallet</h1>
                <p className="mt-2 text-slate-400">
                  A Safe multisig wallet holds your organization's funds. Do you already have one?
                </p>
              </div>

              {/* Choice: existing or create new */}
              {hasSafe === null && (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setHasSafe(true)}
                    className="rounded-xl border border-white/10 bg-navy-800 p-4 text-left transition-all hover:border-accent-500/40 hover:bg-navy-800/80"
                  >
                    <p className="font-semibold text-white">Yes, I have one</p>
                    <p className="mt-1 text-xs text-slate-400">Link an existing Safe wallet</p>
                  </button>
                  <button
                    onClick={() => setHasSafe(false)}
                    className="rounded-xl border border-white/10 bg-navy-800 p-4 text-left transition-all hover:border-accent-500/40 hover:bg-navy-800/80"
                  >
                    <p className="font-semibold text-white">No, create one</p>
                    <p className="mt-1 text-xs text-slate-400">We'll set it up for you</p>
                  </button>
                </div>
              )}

              {/* --- Link existing --- */}
              {hasSafe === true && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-300">Safe address</label>
                    <input
                      type="text"
                      value={existingSafeAddress}
                      onChange={(e) => { setExistingSafeAddress(e.target.value); setSafeError(null); }}
                      placeholder="0x..."
                      autoFocus
                      className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2.5 font-mono text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-300">Chain</label>
                    <select
                      value={selectedChainId}
                      onChange={(e) => setSelectedChainId(Number(e.target.value))}
                      className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2.5 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                    >
                      {CHAINS_LIST.map((c) => (
                        <option key={c.chainId} value={c.chainId}>{c.chainName}</option>
                      ))}
                    </select>
                  </div>

                  {safeError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                      <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-sm text-red-400">{safeError}</p>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Button variant="secondary" onClick={() => setHasSafe(null)} className="w-12 shrink-0">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      onClick={handleLinkExisting}
                      disabled={!existingSafeAddress.trim() || linkingExisting}
                      className="flex-1"
                    >
                      {linkingExisting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Validating...
                        </>
                      ) : (
                        'Link Safe'
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* --- Create new --- */}
              {hasSafe === false && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-white/10 bg-navy-800 p-4">
                    <p className="text-sm font-medium text-slate-300">Owners</p>
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-accent-500/15 px-2 py-0.5 text-xs font-mono text-accent-400">
                          {address?.slice(0, 8)}...{address?.slice(-4)}
                        </span>
                        <span className="text-xs text-slate-500">(you)</span>
                      </div>
                      {teamMembers.map((m, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="rounded bg-white/5 px-2 py-0.5 text-xs font-mono text-slate-300">
                            {m.walletAddress.slice(0, 8)}...{m.walletAddress.slice(-4)}
                          </span>
                          {m.name && <span className="text-xs text-slate-500">{m.name}</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-300">
                      Approval threshold
                    </label>
                    <p className="mb-2 text-xs text-slate-500">
                      How many signatures are required to approve a transaction?
                    </p>
                    <div className="flex items-center gap-3">
                      <select
                        value={safeThreshold}
                        onChange={(e) => setSafeThreshold(Number(e.target.value))}
                        className="w-24 rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                      >
                        {Array.from({ length: 1 + teamMembers.length }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                      <span className="text-sm text-slate-400">
                        of {1 + teamMembers.length} {1 + teamMembers.length === 1 ? 'owner' : 'owners'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-300">Chain</label>
                    <select
                      value={selectedChainId}
                      onChange={(e) => setSelectedChainId(Number(e.target.value))}
                      className="w-full rounded-lg border border-white/10 bg-navy-800 px-4 py-2.5 text-base text-white focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                    >
                      {CHAINS_LIST.map((c) => (
                        <option key={c.chainId} value={c.chainId}>{c.chainName}</option>
                      ))}
                    </select>
                  </div>

                  <p className="text-xs text-slate-500">
                    Clicking "Create Safe" will open a transaction approval in your wallet (e.g. MetaMask).
                    This deploys the Safe contract — a small gas fee applies.
                  </p>

                  {safeError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                      <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-sm text-red-400">{safeError}</p>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Button variant="secondary" onClick={() => setHasSafe(null)} className="w-12 shrink-0">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <Button onClick={handleCreateNewSafe} disabled={deploying} className="flex-1">
                      {deploying ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Deploying Safe...
                        </>
                      ) : (
                        <>
                          <Shield className="h-4 w-4" />
                          Create Safe
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Back to choice when none selected — handled by hasSafe === null above */}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <p className="mt-6 text-center text-xs text-slate-600">
          You can always configure these settings later in your organization's Settings page.
        </p>
      </div>
    </div>
  );
}
