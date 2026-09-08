import { userErrorMessage } from '@/lib/userErrors';
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import {
  LoadingRows,
  Notice,
} from "@/components/workspace/WorkspacePrimitives";
import { roles } from "./memberTypes";
import { formatDate } from "@/lib/formatMoney";
import { InvitationLink } from './InvitationLink';

const deliveryLabels: Record<string, string> = {
  ready_to_share: 'Link ready to share',
  queued: "Queued for email",
  sending: "Sending email",
  submitted: "Accepted by email service",
  delivered: "Delivered to mail server",
  bounced: "Email bounced",
  failed: "Email failed",
  unknown: "Delivery unconfirmed",
  cancelled: "Delivery cancelled",
};
export function Invitations({
  orgId,
  isAdmin,
}: {
  orgId: Id<"orgs">;
  isAdmin: boolean;
}) {
  const sessionToken = useSessionToken();
  const rows = useQuery(
    api.teamInvitations.list,
    sessionToken ? { orgId, sessionToken } : "skip",
  );
  const revoke = useMutation(api.teamInvitations.revoke),
    createLink = useAction(api.teamInvitationLinks.create),
    getLink = useAction(api.teamInvitationLinks.get);
  const [shared, setShared] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState("");
  return (
    <section className="workspace-panel" aria-label="Team invitations">
      <div className="workspace-toolbar">
        <div>
          <h2 className="font-semibold">Invitations</h2>
          <p className="workspace-table-secondary">
            Share private links and track acceptance. Replacing a link expires the old one.
          </p>
        </div>
      </div>
      <div className="p-5 space-y-4">
        {error && <Notice>{error}</Notice>}
        {rows === undefined ? (
          <LoadingRows />
        ) : !rows.length ? (
          <p className="workspace-description">
            No invitations yet. Create a private link for a teammate using their work email.
          </p>
        ) : (
          rows.map((row) => (
            <article
              key={row.id}
              className="rounded-xl border border-white/10 p-4 space-y-3"
              aria-label={`Invitation for ${row.email}`}
            >
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <strong>{row.name || row.email}</strong>
                  {row.name && (
                    <p className="workspace-table-secondary break-all">
                      {row.email}
                    </p>
                  )}
                  <p className="workspace-table-secondary">
                    {roles[row.role][0]}
                  </p>
                </div>
                <div className="text-sm sm:text-right">
                  <strong>
                    {row.status === "pending"
                      ? "Awaiting acceptance"
                      : row.status === "accepted"
                        ? "Accepted"
                        : row.status === "expired"
                          ? "Expired"
                          : row.status === "unavailable" ? "Invitation unavailable" : "Revoked"}
                  </strong>
                  <p className="workspace-table-secondary">
                    {deliveryLabels[row.deliveryStatus]}
                  </p>
                </div>
              </div>
              <p className="workspace-table-secondary">
                Created {formatDate(row.createdAt)} ·{" "}
                {row.status === "accepted" && row.acceptedAt
                  ? `Accepted ${formatDate(row.acceptedAt)}`
                  : `Expires ${formatDate(row.expiresAt)}`}
              </p>
              {row.deliveryError && (
                <p className="text-sm workspace-funding-warning">
                  {userErrorMessage(row.deliveryError, 'The earlier email delivery could not be confirmed.')}
                </p>
              )}
              {isAdmin && row.status !== "accepted" && (
                <div className="flex flex-wrap gap-2">
                  {row.status === 'pending' && row.deliveryStatus === 'ready_to_share' && <button className="workspace-button" disabled={!!busy} onClick={async () => {
                    if (!sessionToken) return;
                    setBusy(row.id); setError('');
                    try { const result = await getLink({ invitationId: row.id, sessionToken }); setShared({ id: row.id, url: result.url }); }
                    catch (error) { setError(userErrorMessage(error, 'The invitation link could not be opened. Try again.')); }
                    finally { setBusy(''); }
                  }}>Share invitation</button>}
                  <button
                    className="workspace-button"
                    disabled={!!busy}
                    onClick={async () => {
                      if (!sessionToken) return;
                      setBusy(row.id);
                      setError("");
                      try {
                        const result = await createLink({
                          orgId,
                          sessionToken,
                          requestId: crypto.randomUUID(),
                          replaces: row.id,
                          email: row.email,
                          name: row.name,
                          role: row.role,
                          expectedWallet: row.expectedWallet,
                        });
                        setShared({ id: result.invitationId, url: result.url });
                      } catch (e) {
                        setError(
                          userErrorMessage(e, "The invitation link could not be replaced."),
                        );
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    {busy === row.id ? "Updating…" : "Replace invitation link"}
                  </button>
                  {["pending", "unavailable"].includes(row.status) && (
                    <button
                      className="workspace-button"
                      disabled={!!busy}
                      onClick={() => setConfirm(row.id)}
                    >
                      Revoke invitation
                    </button>
                  )}
                </div>
              )}
              {shared?.id === row.id && row.status === 'pending' && <InvitationLink url={shared.url} email={row.email} />}
              {confirm === row.id && (
                <div className="space-y-3 border-t border-white/10 pt-3">
                  <p className="text-sm">
                    Revoke the private link for {row.email}? They will need a
                    new invitation to join.
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="workspace-button"
                      disabled={!!busy}
                      onClick={() => setConfirm("")}
                    >
                      Keep invitation
                    </button>
                    <button
                      className="workspace-button"
                      disabled={!!busy}
                      onClick={async () => {
                        if (!sessionToken) return;
                        setBusy(row.id);
                        setError("");
                        try {
                          await revoke({
                            orgId,
                            sessionToken,
                            invitationId: row.id,
                          });
                          setConfirm("");
                        } catch (e) {
                          setError(
                            userErrorMessage(e, "The invitation could not be revoked."),
                          );
                        } finally {
                          setBusy("");
                        }
                      }}
                    >
                      Confirm revocation
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))
        )}
        {!!rows?.length && (
          <p className="workspace-table-secondary">
            Showing the latest {rows.length} invitations. Invitations for a known
            sign-in wallet appear under Members. A shared link does not confirm
            that the invitation has been read or accepted.
          </p>
        )}
      </div>
    </section>
  );
}
