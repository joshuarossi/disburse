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

const deliveryLabels: Record<string, string> = {
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
    send = useAction(api.teamInvitationEmail.send);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState("");
  return (
    <section className="workspace-panel" aria-label="Team invitations">
      <div className="workspace-toolbar">
        <div>
          <h2 className="font-semibold">Email invitations</h2>
          <p className="workspace-table-secondary">
            Track delivery and acceptance. Resending expires the old link.
          </p>
        </div>
      </div>
      <div className="p-5 space-y-4">
        {error && <Notice>{error}</Notice>}
        {rows === undefined ? (
          <LoadingRows />
        ) : !rows.length ? (
          <p className="workspace-description">
            No email invitations yet. Invite a teammate using their work email.
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
                  {row.deliveryError}
                </p>
              )}
              {isAdmin && row.status !== "accepted" && (
                <div className="flex flex-wrap gap-2">
                  <button
                    className="workspace-button"
                    disabled={!!busy}
                    onClick={async () => {
                      if (!sessionToken) return;
                      setBusy(row.id);
                      setError("");
                      try {
                        await send({
                          orgId,
                          sessionToken,
                          requestId: crypto.randomUUID(),
                          replaces: row.id,
                          email: row.email,
                          name: row.name,
                          role: row.role,
                          expectedWallet: row.expectedWallet,
                        });
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "The invitation could not be resent.",
                        );
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    {busy === row.id ? "Updating…" : "Resend invitation"}
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
                            e instanceof Error
                              ? e.message
                              : "The invitation could not be revoked.",
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
            Showing the latest {rows.length} email invitations. Wallet
            invitations appear under Members. Delivery confirms arrival at the
            mail server, not that the invitation was read.
          </p>
        )}
      </div>
    </section>
  );
}
