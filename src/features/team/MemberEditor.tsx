import { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { useSessionToken } from "@/lib/session";
import { isValidAddress } from "../../../shared/validation";

import { roles, type TeamMember } from "./memberTypes";
export function MemberEditor({
  orgId,
  member,
  isAdmin,
  onClose,
}: {
  orgId: Id<"orgs">;
  member?: TeamMember;
  isAdmin: boolean;
  onClose: (created?: "email" | "wallet") => void;
}) {
  const sessionToken = useSessionToken();
  const invite = useMutation(api.orgs.inviteMember);
  const emailInvite = useAction(api.teamInvitationEmail.send);
  const update = useMutation(api.orgs.updateMember);
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [wallet, setWallet] = useState(member?.walletAddress ?? "");
  const [role, setRole] = useState<keyof typeof roles>(
    member?.role ?? "viewer",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<"email" | "wallet">("email");
  const [bindWallet, setBindWallet] = useState(false);
  const [created, setCreated] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const lock = useRef(false);
  if (created)
    return (
      <Dialog title="Invitation created" onClose={() => onClose(method)}>
        <div className="space-y-5 p-6">
          <p>
            {method === "email"
              ? `An invitation to ${email.trim()} is queued for delivery. Check Invitations for its delivery and acceptance status.`
              : "The invitation is ready for this sign-in wallet. Share the sign-in link with your teammate; no email has been sent."}
          </p>
          {method === "wallet" && (
            <button
              className="workspace-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${window.location.origin}/login`,
                  );
                  setCopied(true);
                } catch {
                  setError("The sign-in link could not be copied.");
                }
              }}
            >
              {copied ? "Sign-in link copied" : "Copy sign-in link"}
            </button>
          )}
          <p className="workspace-description">
            The invitation expires in seven days. Access starts when your
            teammate accepts.
          </p>
          {error && <Notice>{error}</Notice>}
          <button
            className="workspace-button workspace-button-primary"
            onClick={() => onClose(method)}
          >
            Done
          </button>
        </div>
      </Dialog>
    );
  return (
    <Dialog
      title={member ? "Edit team member" : "Invite a team member"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!sessionToken || lock.current) return;
          if (
            (member || method === "wallet" || bindWallet) &&
            !isValidAddress(wallet.trim())
          ) {
            setError("Enter the wallet this member will use to sign in.");
            return;
          }
          lock.current = true;
          setBusy(true);
          setError("");
          try {
            if (member)
              await update({
                orgId,
                sessionToken,
                membershipId: member.membershipId,
                name,
                email,
                role,
              });
            else if (method === "email")
              await emailInvite({
                orgId,
                sessionToken,
                requestId: requestId.current,
                email: email.trim(),
                name: name.trim() || undefined,
                role,
                expectedWallet: bindWallet ? wallet.trim() : undefined,
              });
            else
              await invite({
                orgId,
                sessionToken,
                memberWalletAddress: wallet.trim(),
                memberName: name.trim() || undefined,
                memberEmail: email.trim() || undefined,
                role,
              });
            if (member) onClose();
            else setCreated(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save member");
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        {error && <Notice>{error}</Notice>}
        {!member && (
          <fieldset disabled={busy} className="flex flex-wrap gap-4 text-sm">
            <legend className="finance-label mb-2">Invitation method</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="invite-method"
                value="email"
                checked={method === "email"}
                onChange={() => setMethod("email")}
              />
              Email invitation
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="invite-method"
                value="wallet"
                checked={method === "wallet"}
                onChange={() => setMethod("wallet")}
              />
              Use a known sign-in wallet
            </label>
          </fieldset>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="finance-label">Full name</span>
            <input
              autoFocus
              className="finance-field"
              disabled={busy}
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            <span className="finance-label">Work email</span>
            <input
              className="finance-field"
              type="email"
              disabled={busy}
              required={!member && method === "email"}
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>
        {!member && method === "email" && (
          <div className="space-y-3">
            <p className="workspace-description">
              Your teammate receives a private link, then signs in and confirms
              the wallet they will use. You don't need their wallet address to
              invite them.
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                disabled={busy}
                checked={bindWallet}
                onChange={(e) => setBindWallet(e.target.checked)}
              />
              Require a specific sign-in wallet
            </label>
          </div>
        )}
        {(member || method === "wallet" || bindWallet) && (
          <label className="block">
            <span className="finance-label">Sign-in wallet</span>
            <input
              className="finance-field font-mono"
              aria-label="Sign-in wallet"
              disabled={!!member || busy}
              value={wallet}
              placeholder="0x…"
              onChange={(e) => setWallet(e.target.value)}
            />
            <span className="workspace-table-secondary">
              The member accepts this invitation when they sign in with this
              wallet.
            </span>
          </label>
        )}
        <label className="block">
          <span className="finance-label">Workspace role</span>
          <select
            className="finance-field"
            aria-label="Workspace role"
            aria-describedby="member-role-help"
            disabled={!isAdmin || busy}
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            {Object.entries(roles).map(([key, [label]]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <span id="member-role-help" className="workspace-table-secondary">
            {roles[role][1]}
          </span>
        </label>
        <Notice tone="info">
          Workspace access does not grant account ownership or permission to
          spend directly. Set payment limits and delegated spending separately.
        </Notice>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="workspace-button"
            disabled={busy}
            onClick={() => onClose()}
          >
            Cancel
          </button>
          <button
            className="workspace-button workspace-button-primary"
            disabled={busy}
          >
            {busy
              ? "Saving…"
              : member
                ? "Save changes"
                : method === "email"
                  ? "Send invitation"
                  : "Create invitation"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
