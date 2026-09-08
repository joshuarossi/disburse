import { userErrorMessage } from '@/lib/userErrors';
import { useRef, useState } from "react";
import { getSessionToken } from "@/lib/session";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CustomerPaidSetup } from "@/features/onboarding/CustomerPaidSetup";
import { useAccount } from "wagmi";
import { getAddress, isAddress } from "viem";
import { useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { walletErrorMessage } from "@/lib/walletErrors";
import { CHAINS_LIST } from "@/lib/chains";
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
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Role = "admin" | "approver" | "initiator" | "clerk" | "viewer";
type Step = "profile" | "create-org" | "team" | "safe";

const STEPS: Step[] = ["profile", "create-org", "team", "safe"];

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
  const [searchParams] = useSearchParams();
  const { address, chain } = useAccount();
  const setupLock = useRef(false);
  const invitedWallets = useRef(new Set<string>());
  const [ownerWallets, setOwnerWallets] = useState<string[]>([]);
  const [recoveredOwners, setRecoveredOwners] = useState<string[]>([]);

  // ---- profile state ----
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  // ---- org state ----
  const [orgName, setOrgName] = useState("");
  const [orgId, setOrgId] = useState<string | null>(searchParams.get("org"));

  // ---- team state ----
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [newMember, setNewMember] = useState<TeamMember>({
    walletAddress: "",
    name: "",
    email: "",
    role: "approver",
  });
  const [isAddingMember, setIsAddingMember] = useState(false);

  // ---- safe state ----
  const [hasSafe, setHasSafe] = useState<boolean | null>(null); // null = not yet chosen
  const [existingSafeAddress, setExistingSafeAddress] = useState("");
  const [selectedChainId, setSelectedChainId] = useState(chain?.id === 11155111 ? 84532 : chain?.id ?? 8453);
  const [safeThreshold, setSafeThreshold] = useState(1);
  const [deploying, setDeploying] = useState(false);
  const [safeError, setSafeError] = useState<string | null>(null);
  const [linkingExisting, setLinkingExisting] = useState(false);
  const primaryOwner = deploying && recoveredOwners.length ? recoveredOwners[0] : address;

  // ---- nav state ----
  const [step, setStep] = useState<Step>(searchParams.has("org") ? "safe" : "profile");
  const [orgError, setOrgError] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);

  // ---- mutations ----
  const createOrg = useMutation(api.orgs.create);
  const updateOwnProfile = useMutation(api.orgs.updateOwnProfile);
  const inviteMember = useMutation(api.orgs.inviteMember);
  const linkSafe = useAction(api.safes.link);


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
    if (!address || !orgName.trim() || setupLock.current) return;
    setupLock.current = true;
    setOrgError(null);

    try {
      const { orgId: newOrgId } = orgId
        ? { orgId: orgId as Id<"orgs"> }
        : await createOrg({
            name: orgName.trim(),
            sessionToken: getSessionToken() ?? "",
          });
      setOrgId(newOrgId);
      navigate(`/onboarding?org=${newOrgId}`, { replace: true });

      // Persist the profile name/email collected in step 1 onto the creator's membership
      if (name.trim() || email.trim()) {
        await updateOwnProfile({
          orgId: newOrgId,
          sessionToken: getSessionToken() ?? "",
          name: name.trim() || undefined,
          email: email.trim() || undefined,
        });
      }

      setStep("team");
    } catch (err) {
      setOrgError(
        userErrorMessage(err, "Failed to create organization"),
      );
    } finally {
      setupLock.current = false;
    }
  };

  // --- Team: add a member to the local list ---
  const handleAddMember = () => {
    const supplied = newMember.walletAddress.trim();
    if (!supplied) return;
    setTeamError(null);
    if (!isAddress(supplied, { strict: false }) || /^0x0{40}$/i.test(supplied)) {
      setTeamError('Enter a valid wallet address for this team member.');
      return;
    }
    const memberAddress = getAddress(supplied.toLowerCase());

    if (memberAddress.toLowerCase() === address?.toLowerCase()) {
      setTeamError("You're already a member of this organization.");
      return;
    }
    if (
      teamMembers.some(
        (m) =>
          m.walletAddress.toLowerCase() ===
          memberAddress.toLowerCase(),
      )
    ) {
      setTeamError("This wallet is already in the list.");
      return;
    }

    setTeamMembers((prev) => [
      ...prev,
      { ...newMember, walletAddress: memberAddress },
    ]);
    setNewMember({ walletAddress: "", name: "", email: "", role: "approver" });
    setIsAddingMember(false);
  };

  const handleRemoveMember = (idx: number) => {
    setTeamMembers((prev) => prev.filter((_, i) => i !== idx));
  };

  // --- Team → next (persists members, advances) ---
  const handleTeamNext = async () => {
    if (!orgId || !address || setupLock.current) return;
    setupLock.current = true;
    setTeamError(null);

    try {
      // Persist all team members
      for (const member of teamMembers) {
        if (invitedWallets.current.has(member.walletAddress.toLowerCase()))
          continue;
        await inviteMember({
          orgId: orgId as Id<"orgs">,
          sessionToken: getSessionToken() ?? "",
          memberWalletAddress: member.walletAddress,
          memberName: member.name || undefined,
          memberEmail: member.email || undefined,
          role: member.role,
        });
        invitedWallets.current.add(member.walletAddress.toLowerCase());
      }
      setStep("safe");
    } catch (err) {
      setTeamError(
        userErrorMessage(err, "Failed to add team members"),
      );
    } finally {
      setupLock.current = false;
    }
  };

  // --- Safe: link an existing safe ---
  const handleLinkExisting = async () => {
    if (!orgId || !address || !existingSafeAddress.trim()) return;
    setSafeError(null);
    setLinkingExisting(true);

    try {
      await linkSafe({
        orgId: orgId as Id<"orgs">,
        sessionToken: getSessionToken() ?? "",
        safeAddress: existingSafeAddress.trim(),
        chainId: selectedChainId,
      });

      // Done — go to dashboard
      navigate(`/org/${orgId}/dashboard`);
    } catch (err) {
      setSafeError(walletErrorMessage(err, "Could not link this account. Check its address and network, then try again."));
    } finally {
      setLinkingExisting(false);
    }
  };

  // Profile entry does not require an on-chain transaction.
  const handleProfileAndAdvance = () => {
    setStep("create-org");
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const StepBadge = ({
    s,
    label,
    icon: Icon,
  }: {
    s: Step;
    label: string;
    icon: typeof User;
  }) => {
    const idx = STEPS.indexOf(s);
    const currentIdx = STEPS.indexOf(step);
    const done = idx < currentIdx;
    const active = idx === currentIdx;

    return (
      <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
            done
              ? "border-[var(--ws-accent)] bg-[var(--ws-accent)]"
              : active
                ? "border-[var(--ws-accent)] bg-[var(--ws-subtle)]"
                : "border-[var(--ws-border)] bg-[var(--ws-subtle)]"
          }`}
        >
          {done ? (
            <Check className="h-4 w-4 text-[var(--ws-surface)]" />
          ) : (
            <Icon
              className={`h-4 w-4 ${active ? "text-[var(--ws-accent)]" : "text-[var(--ws-muted)]"}`}
            />
          )}
        </div>
        <span
          className={`text-[11px] font-medium sm:text-xs ${active ? "text-[var(--ws-text)]" : done ? "text-[var(--ws-accent)]" : "text-[var(--ws-muted)]"}`}
        >
          {label}
        </span>
      </div>
    );
  };

  const stepIcons: Record<Step, typeof User> = {
    profile: User,
    "create-org": Building2,
    team: Users,
    safe: Shield,
  };

  const stepLabels: Record<Step, string> = {
    profile: "Profile",
    "create-org": "Organization",
    team: "Team",
    safe: "Funding",
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="workspace workspace-entry flex min-h-screen flex-col items-center justify-center bg-[var(--ws-bg)] px-6 py-12">
      <div className="w-full max-w-lg">
        {/* Progress bar */}
        <div className="mb-8 flex items-center justify-between">
          {STEPS.map((s) => (
            <StepBadge
              key={s}
              s={s}
              label={stepLabels[s]}
              icon={stepIcons[s]}
            />
          ))}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[var(--ws-border)] bg-[var(--ws-surface)] p-5 sm:p-8">
          {/* ================================================================
              STEP: PROFILE
              ============================================================== */}
          {step === "profile" && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-[var(--ws-text)]">
                  Welcome to Disburse
                </h1>
                <p className="mt-2 text-[var(--ws-muted)]">
                  Tell us a bit about yourself. Both fields are optional — you
                  can always update later.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="onboarding-name"
                    className="mb-1.5 block text-sm font-medium text-[var(--ws-text)]"
                  >
                    Name
                  </label>
                  <input
                    id="onboarding-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-4 py-2.5 text-[var(--ws-text)] placeholder:text-[var(--ws-muted)] focus:border-[var(--ws-accent)] focus:outline-none focus:ring-1 focus:ring-accent-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="onboarding-email"
                    className="mb-1.5 block text-sm font-medium text-[var(--ws-text)]"
                  >
                    Email
                  </label>
                  <input
                    id="onboarding-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-4 py-2.5 text-[var(--ws-text)] placeholder:text-[var(--ws-muted)] focus:border-[var(--ws-accent)] focus:outline-none focus:ring-1 focus:ring-accent-500"
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
          {step === "create-org" && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-[var(--ws-text)]">
                  Create your organization
                </h1>
                <p className="mt-2 text-[var(--ws-muted)]">
                  Your organization is the workspace where you manage
                  disbursements and team members.
                </p>
              </div>

              <div>
                <label
                  htmlFor="onboarding-orgName"
                  className="mb-1.5 block text-sm font-medium text-[var(--ws-text)]"
                >
                  Organization name
                </label>
                <input
                  id="onboarding-orgName"
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  autoFocus
                  className="w-full rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-4 py-2.5 text-[var(--ws-text)] placeholder:text-[var(--ws-muted)] focus:border-[var(--ws-accent)] focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              </div>

              {orgError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3"
                >
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-400">{orgError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  aria-label="Back"
                  onClick={goBack}
                  className="w-12 shrink-0"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                  onClick={handleCreateOrg}
                  disabled={!orgName.trim()}
                  className="flex-1"
                >
                  Create organization
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ================================================================
              STEP: TEAM
              ============================================================== */}
          {step === "team" && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-[var(--ws-text)]">
                  Add team members
                </h1>
                <p className="mt-2 text-[var(--ws-muted)]">
                  Invite people to your organization. You can always add more
                  later. This step is optional.
                </p>
              </div>

              {/* Existing members list */}
              {teamMembers.length > 0 && (
                <div className="space-y-2">
                  {teamMembers.map((m, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--ws-text)] font-mono">
                          {m.walletAddress.slice(0, 8)}...
                          {m.walletAddress.slice(-4)}
                        </p>
                        <p className="text-xs text-[var(--ws-muted)] capitalize">
                          {m.name || "No name"} · {m.role}
                        </p>
                      </div>
                      <button
                        aria-label={`Remove ${m.name || 'team member'} from this list`}
                        onClick={() => handleRemoveMember(idx)}
                        className="text-[var(--ws-muted)] hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add member form */}
              {isAddingMember ? (
                <div className="rounded-lg border border-[var(--ws-accent)]/30 bg-[var(--ws-subtle)] p-4 space-y-3">
                  <div>
                    <label
                      htmlFor="onboarding-newMember-walletAddress"
                      className="mb-1 block text-xs font-medium text-[var(--ws-muted)]"
                    >
                      Wallet address *
                    </label>
                    <input
                      id="onboarding-newMember-walletAddress"
                      type="text"
                      value={newMember.walletAddress}
                      onChange={(e) =>
                        setNewMember((prev) => ({
                          ...prev,
                          walletAddress: e.target.value,
                        }))
                      }
                      placeholder="0x..."
                      autoFocus
                      className="w-full rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-3 py-2 font-mono text-sm text-[var(--ws-text)] placeholder:text-[var(--ws-muted)] focus:border-[var(--ws-accent)] focus:outline-none focus:ring-1 focus:ring-accent-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="onboarding-newMember-name"
                        className="mb-1 block text-xs font-medium text-[var(--ws-muted)]"
                      >
                        Name
                      </label>
                      <input
                        id="onboarding-newMember-name"
                        type="text"
                        value={newMember.name}
                        onChange={(e) =>
                          setNewMember((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        placeholder="Name"
                        className="w-full rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-3 py-2 text-sm text-[var(--ws-text)] placeholder:text-[var(--ws-muted)] focus:border-[var(--ws-accent)] focus:outline-none focus:ring-1 focus:ring-accent-500"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="onboarding-newMember-email"
                        className="mb-1 block text-xs font-medium text-[var(--ws-muted)]"
                      >
                        Email
                      </label>
                      <input
                        id="onboarding-newMember-email"
                        type="email"
                        value={newMember.email}
                        onChange={(e) =>
                          setNewMember((prev) => ({
                            ...prev,
                            email: e.target.value,
                          }))
                        }
                        placeholder="Email"
                        className="w-full rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-3 py-2 text-sm text-[var(--ws-text)] placeholder:text-[var(--ws-muted)] focus:border-[var(--ws-accent)] focus:outline-none focus:ring-1 focus:ring-accent-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="onboarding-newMember-role"
                      className="mb-1 block text-xs font-medium text-[var(--ws-muted)]"
                    >
                      Role
                    </label>
                    <select
                      id="onboarding-newMember-role"
                      value={newMember.role}
                      onChange={(e) =>
                        setNewMember((prev) => ({
                          ...prev,
                          role: e.target.value as Role,
                        }))
                      }
                      className="w-full rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-3 py-2 text-sm text-[var(--ws-text)] focus:border-[var(--ws-accent)] focus:outline-none focus:ring-1 focus:ring-accent-500"
                    >
                      <option value="approver">Approver</option>
                      <option value="initiator">Initiator</option>
                      <option value="clerk">Clerk</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={handleAddMember}
                      disabled={!newMember.walletAddress.trim()}
                      className="flex-1"
                    >
                      Add
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setIsAddingMember(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => setIsAddingMember(true)}
                  className="w-full"
                >
                  <Plus className="h-4 w-4" />
                  Add a team member
                </Button>
              )}

              {teamError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3"
                >
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-400">{teamError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  aria-label="Back"
                  onClick={goBack}
                  className="w-12 shrink-0"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button onClick={handleTeamNext} className="flex-1">
                  {teamMembers.length === 0 ? "Skip for now" : "Continue"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ================================================================
              STEP: SAFE
              ============================================================== */}
          {step === "safe" && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-[var(--ws-text)]">
                  Set up your company account
                </h1>
                <p className="mt-2 text-[var(--ws-muted)]">
                  This account holds the stablecoins your team pays from. Disburse uses Safe
                  to keep funds under your team's control. Connect an existing Safe account
                  or create one below.
                </p>
              </div>

              {/* Choice: existing or create new */}
              {hasSafe === null && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={() => setHasSafe(true)}
                    className="rounded-xl border border-[var(--ws-border)] bg-[var(--ws-subtle)] p-4 text-left transition-all hover:border-[var(--ws-accent)]/40 hover:bg-[var(--ws-subtle)]"
                  >
                    <p className="font-semibold text-[var(--ws-text)]">Connect an existing account</p>
                    <p className="mt-1 text-xs text-[var(--ws-muted)]">
                      Use a company account your team already controls in Safe.
                    </p>
                  </button>
                  <button
                    onClick={() => setHasSafe(false)}
                    className="rounded-xl border border-[var(--ws-border)] bg-[var(--ws-subtle)] p-4 text-left transition-all hover:border-[var(--ws-accent)]/40 hover:bg-[var(--ws-subtle)]"
                  >
                    <p className="font-semibold text-[var(--ws-text)]">Create a company account</p>
                    <p className="mt-1 text-xs text-[var(--ws-muted)]">
                      Choose who can approve payments and keep control of your funds.
                    </p>
                  </button>
                </div>
              )}

              {/* --- Link existing --- */}
              {hasSafe === true && (
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="onboarding-existingSafeAddress"
                      className="mb-1.5 block text-sm font-medium text-[var(--ws-text)]"
                    >
                      Company account address in Safe
                    </label>
                    <input
                      id="onboarding-existingSafeAddress"
                      type="text"
                      value={existingSafeAddress}
                      onChange={(e) => {
                        setExistingSafeAddress(e.target.value);
                        setSafeError(null);
                      }}
                      placeholder="0x..."
                      autoFocus
                      className="w-full rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-4 py-2.5 font-mono text-sm text-[var(--ws-text)] placeholder:text-[var(--ws-muted)] focus:border-[var(--ws-accent)] focus:outline-none focus:ring-1 focus:ring-accent-500"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="onboarding-selectedChainId"
                      className="mb-1.5 block text-sm font-medium text-[var(--ws-text)]"
                    >
                      Payment network
                    </label>
                    <select
                      id="onboarding-selectedChainId"
                      value={selectedChainId}
                      disabled={deploying || linkingExisting}
                      onChange={(e) =>
                        setSelectedChainId(Number(e.target.value))
                      }
                      className="w-full rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-4 py-2.5 text-base text-[var(--ws-text)] focus:border-[var(--ws-accent)] focus:outline-none focus:ring-1 focus:ring-accent-500"
                    >
                      {CHAINS_LIST.map((c) => (
                        <option key={c.chainId} value={c.chainId}>
                          {c.chainName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {safeError && (
                    <Notice tone="error">{safeError}</Notice>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Button
                      variant="secondary"
                      aria-label="Back"
                      disabled={linkingExisting}
                      onClick={() => { setHasSafe(null); setSafeError(null); }}
                      className="w-12 shrink-0"
                    >
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
                        "Connect account"
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* --- Create new --- */}
              {hasSafe === false && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] p-4">
                    <p className="text-sm font-medium text-[var(--ws-text)]">
                      Who controls company funds?
                    </p>
                    <p className="mt-2 text-xs leading-5 text-[var(--ws-muted)]">
                      These people are account owners. They can move funds and change
                      account permissions, including outside Disburse. A workspace
                      role alone does not give someone this control.
                    </p>
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-accent-500/15 px-2 py-0.5 text-xs font-mono text-[var(--ws-text)]">
                          {primaryOwner?.slice(0, 8)}...{primaryOwner?.slice(-4)}
                        </span>
                        <span className="text-xs text-[var(--ws-muted)]">{primaryOwner?.toLowerCase() === address?.toLowerCase() ? '(you)' : '(setup owner)'}</span>
                      </div>
                      {[...teamMembers, ...Array.from(new Set([...recoveredOwners, ...ownerWallets])).filter(wallet => wallet.toLowerCase() !== primaryOwner?.toLowerCase() && !teamMembers.some(member => member.walletAddress.toLowerCase() === wallet.toLowerCase())).map(walletAddress => ({ walletAddress, name: "" }))].map((m, idx) => (
                        <label key={idx} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            disabled={deploying}
                            checked={ownerWallets.includes(m.walletAddress)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...ownerWallets, m.walletAddress]
                                : ownerWallets.filter(
                                    (a) => a !== m.walletAddress,
                                  );
                              setOwnerWallets(next);
                              setSafeThreshold((t) =>
                                Math.min(t, next.length + 1),
                              );
                            }}
                          />
                          <span className="rounded bg-[var(--ws-subtle)] px-2 py-0.5 text-xs font-mono text-[var(--ws-text)]">
                            {m.walletAddress.slice(0, 8)}...
                            {m.walletAddress.slice(-4)}
                          </span>
                          {m.name && (
                            <span className="text-xs text-[var(--ws-muted)]">
                              {m.name}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="onboarding-safeThreshold"
                      className="mb-1.5 block text-sm font-medium text-[var(--ws-text)]"
                    >
                      Approvals required
                    </label>
                    <p className="mb-2 text-xs text-[var(--ws-muted)]">
                      How many account owners must approve each payment or account change?
                    </p>
                    <div className="flex items-center gap-3">
                      <select
                        id="onboarding-safeThreshold"
                        value={safeThreshold}
                        disabled={deploying}
                        onChange={(e) =>
                          setSafeThreshold(Number(e.target.value))
                        }
                        className="w-24 rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-3 py-2 text-[var(--ws-text)] focus:border-[var(--ws-accent)] focus:outline-none focus:ring-1 focus:ring-accent-500"
                      >
                        {Array.from(
                          { length: 1 + ownerWallets.length },
                          (_, i) => i + 1,
                        ).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                      <span className="text-sm text-[var(--ws-muted)]">
                        of {1 + ownerWallets.length}{" "}
                        {1 + ownerWallets.length === 1 ? "owner" : "owners"}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="onboarding-selectedChainId"
                      className="mb-1.5 block text-sm font-medium text-[var(--ws-text)]"
                    >
                      Payment network
                    </label>
                    <select
                      id="onboarding-selectedChainId"
                      value={selectedChainId}
                      disabled={deploying || linkingExisting}
                      onChange={(e) =>
                        setSelectedChainId(Number(e.target.value))
                      }
                      className="w-full rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] px-4 py-2.5 text-base text-[var(--ws-text)] focus:border-[var(--ws-accent)] focus:outline-none focus:ring-1 focus:ring-accent-500"
                    >
                      {CHAINS_LIST.map((c) => (
                        <option key={c.chainId} value={c.chainId}>
                          {c.chainName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {orgId && address && <CustomerPaidSetup
                    orgId={orgId as Id<"orgs">}
                    owners={[address, ...ownerWallets]}
                    threshold={safeThreshold}
                    chainId={selectedChainId}
                    onBusy={setDeploying}
                    onRestore={saved => { setSelectedChainId(saved.chainId); setSafeThreshold(saved.threshold); setRecoveredOwners(saved.owners); setOwnerWallets(saved.owners.slice(1)); }}
                    onComplete={() => navigate(`/org/${orgId}/dashboard`)}
                  />}
                  {!deploying && <Button variant="secondary" aria-label="Back" onClick={() => setHasSafe(null)} className="w-12"><ArrowLeft className="h-4 w-4" /></Button>}
                </div>
              )}

              {/* Back to choice when none selected — handled by hasSafe === null above */}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <p className="mt-6 text-center text-xs text-[var(--ws-muted)]">
          You can always configure these settings later in your organization's
          Settings page.
        </p>
      </div>
    </div>
  );
}
