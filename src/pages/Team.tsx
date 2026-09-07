import { lazy, Suspense, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { useMutation, useQuery } from "convex/react";
import { Plus, Users, Pencil, UserMinus } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { MemberEditor } from "@/features/team/MemberEditor";
import { Invitations } from "@/features/team/Invitations";
import { roles, type TeamMember } from "@/features/team/memberTypes";
import { MemberSpendingLimits } from "@/components/payments/MemberSpendingLimits";
const SafeSpendingPolicies = lazy(() =>
  import("@/components/payments/SafeSpendingPolicies").then((module) => ({
    default: module.SafeSpendingPolicies,
  })),
);
const MemberAccess = lazy(() =>
  import("@/features/team/MemberAccess").then((module) => ({
    default: module.MemberAccess,
  })),
);
import { Dialog } from "@/components/ui/Dialog";
import {
  EmptyState,
  LoadingRows,
  Notice,
  PageHeader,
  SearchField,
  StatusBadge,
} from "@/components/workspace/WorkspacePrimitives";

export default function Team() {
  const { orgId } = useParams();
  const { address } = useAccount();
  const sessionToken = useSessionToken();
  const args =
    orgId && sessionToken
      ? { orgId: orgId as Id<"orgs">, sessionToken }
      : "skip";
  const members = useQuery(api.orgs.listMembers, args);
  const removeMember = useMutation(api.orgs.removeMember);
  const isAdmin =
    members?.some(
      (m) =>
        m &&
        m.walletAddress.toLowerCase() === address?.toLowerCase() &&
        m.role === "admin" &&
        m.status === "active",
    ) ?? false;
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "members";
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<TeamMember | "new" | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [accessId, setAccessId] = useState<Id<"orgMemberships"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState(false);
  const visible = members?.filter(
    (m) =>
      m &&
      ["active", "invited"].includes(m.status) &&
      `${m.name ?? ""} ${m.email ?? ""} ${m.walletAddress}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        title="Team & approvals"
        description="Give each person the access and spending authority their work needs."
        actions={
          isAdmin && (
            <button
              className="workspace-button workspace-button-primary"
              onClick={() => setEditor("new")}
            >
              <Plus size={14} />
              Invite member
            </button>
          )
        }
      />
      <div
        className="workspace-tabs mb-6"
        role="tablist"
        aria-label="Team settings"
      >
        {Object.entries({
          members: "Members",
          invitations: "Invitations",
          limits: "Payment limits",
          delegation: "Delegated spending",
        }).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams({ tab: key })}
          >
            {label}
          </button>
        ))}
      </div>
      {removed && (
        <div className="mb-5">
          <Notice tone="info">
            Workspace access was removed. Review this person's account ownership
            and delegated spending grants; those remain active until account
            owners revoke them.{" "}
            <button
              className="underline"
              onClick={() => setParams({ tab: "delegation" })}
            >
              Review delegated spending
            </button>
          </Notice>
        </div>
      )}
      {tab === "invitations" ? (
        <Invitations orgId={orgId as Id<"orgs">} isAdmin={isAdmin} />
      ) : tab === "limits" ? (
        <MemberSpendingLimits orgId={orgId as Id<"orgs">} isAdmin={isAdmin} />
      ) : tab === "delegation" ? (
        <SafeSpendingPolicies orgId={orgId as Id<"orgs">} isAdmin={isAdmin} />
      ) : (
        <section className="workspace-panel">
          <div className="workspace-toolbar">
            <div>
              <h2 className="text-sm font-semibold">Workspace members</h2>
              <p className="workspace-table-secondary">
                Invited members receive access only after accepting.
              </p>
            </div>
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Search team"
            />
          </div>
          {visible === undefined ? (
            <LoadingRows />
          ) : !visible.length ? (
            <EmptyState
              icon={Users}
              title="No matching members"
              description="Search by name, email, or sign-in wallet."
            />
          ) : (
            <div className="workspace-table-wrap">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Workspace role</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((m) => {
                    if (!m) return null;
                    const self =
                      m.walletAddress.toLowerCase() === address?.toLowerCase();
                    return (
                      <tr key={m.membershipId}>
                        <td>
                          <div className="workspace-person">
                            <span className="workspace-avatar">
                              {(m.name || "TM").slice(0, 2).toUpperCase()}
                            </span>
                            <span>
                              <strong>
                                {m.name ||
                                  `${m.walletAddress.slice(0, 6)}…${m.walletAddress.slice(-4)}`}
                                {self && (
                                  <span className="ml-2 text-xs font-normal text-slate-400">
                                    You
                                  </span>
                                )}
                              </strong>
                              <span className="workspace-table-secondary">
                                {m.email ||
                                  `${m.walletAddress.slice(0, 8)}…${m.walletAddress.slice(-6)}`}
                                {m.emailVerifiedAt && (
                                  <span className="block">Email verified</span>
                                )}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td>{roles[m.role][0]}</td>
                        <td>
                          <StatusBadge
                            status={m.status}
                            label={
                              m.status === "invited"
                                ? m.invitationExpiresAt &&
                                  m.invitationExpiresAt <= Date.now()
                                  ? "Invitation expired"
                                  : "Invitation pending"
                                : undefined
                            }
                          />
                        </td>
                        <td>
                          <div className="flex justify-end gap-2">
                            <button
                              className="workspace-button"
                              aria-label={`View access for ${m.name || "member"}`}
                              onClick={() => setAccessId(m.membershipId)}
                            >
                              View access
                            </button>
                            {(isAdmin || self) && (
                              <button
                                aria-label={`Edit ${m.name || "member"}`}
                                className="workspace-button"
                                onClick={() => setEditor(m)}
                              >
                                <Pencil size={13} />
                                Edit
                              </button>
                            )}
                            {isAdmin && !self && (
                              <button
                                aria-label={`Remove ${m.name || "member"}`}
                                className="workspace-button"
                                onClick={() => {
                                  setError("");
                                  setRemoving(m);
                                }}
                              >
                                <UserMinus size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="workspace-table-footer">
            <span>{visible?.length ?? 0} members</span>
            <span>Account signatures require separate owner permissions</span>
          </div>
        </section>
      )}
      {editor && (
        <MemberEditor
          orgId={orgId as Id<"orgs">}
          member={editor === "new" ? undefined : editor}
          isAdmin={isAdmin}
          onClose={(created) => {
            setEditor(null);
            if (created)
              setParams({
                tab: created === "email" ? "invitations" : "members",
              });
          }}
        />
      )}
      {accessId && (
        <Suspense
          fallback={
            <Dialog title="Member access" onClose={() => setAccessId(null)}>
              <LoadingRows />
            </Dialog>
          }
        >
          <MemberAccess
            orgId={orgId as Id<"orgs">}
            membershipId={accessId}
            onClose={() => setAccessId(null)}
            onManage={
              isAdmin
                ? (tab) => {
                    setAccessId(null);
                    setParams({ tab });
                  }
                : undefined
            }
          />
        </Suspense>
      )}
      {removing && (
        <Dialog
          title={`Remove ${removing.name || "team member"}?`}
          onClose={() => {
            if (!busy) setRemoving(null);
          }}
        >
          <div className="space-y-5 p-6">
            {error && <Notice>{error}</Notice>}
            <p className="workspace-description">
              This removes workspace access. Existing payment records remain
              available to the team.
            </p>
            <Notice tone="info">
              Account ownership and contract spending grants are separate.
              Account owners must revoke those permissions independently.
            </Notice>
            <div className="flex justify-end gap-2">
              <button
                className="workspace-button"
                disabled={busy}
                onClick={() => setRemoving(null)}
              >
                Keep member
              </button>
              <button
                className="workspace-button workspace-button-primary"
                disabled={busy}
                onClick={async () => {
                  if (args === "skip" || busy) return;
                  setBusy(true);
                  setError("");
                  try {
                    await removeMember({
                      ...args,
                      membershipId: removing.membershipId,
                    });
                    setRemoving(null);
                    setRemoved(true);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not remove member",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Removing…" : "Remove access"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
