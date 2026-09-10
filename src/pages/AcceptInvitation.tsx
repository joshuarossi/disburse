import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import { userErrorMessage } from "@/lib/userErrors";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { useAccount, useDisconnect } from "wagmi";
import { Moon, Sun, CheckCircle2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { clearSessionToken, useSessionToken } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { teamRoles } from "../../shared/teamRoles";
import { formatDate } from "@/lib/formatMoney";

function Invitation({ token }: { token: string }) {
  useWorkspaceLanguage();
  const valid = /^[a-f0-9]{64}$/.test(token),
    sessionToken = useSessionToken(),
    { address } = useAccount();
  const { disconnect } = useDisconnect();
  const invitation = useQuery(
    api.teamInvitations.get,
    valid ? { token } : "skip",
  );
  const session = useQuery(
    api.auth.validateSession,
    sessionToken ? { token: sessionToken } : "skip",
  );
  const accept = useMutation(api.teamInvitations.accept);
  const [confirmedWallet, setConfirmedWallet] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [joined, setJoined] = useState("");
  const confirmed =
    !!session && confirmedWallet === session.walletAddress.toLowerCase();
  const signedIn =
    !!session && session.walletAddress.toLowerCase() === address?.toLowerCase();
  const join = async () => {
    if (!sessionToken || !signedIn || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await accept({
        token,
        sessionToken,
        confirmWallet: confirmed || invitation?.status === "accepted",
      });
      setJoined(result.orgId);
    } catch (e) {
      setError(userErrorMessage(e, "The invitation could not be accepted."));
    } finally {
      setBusy(false);
    }
  };
  if (joined)
    return (
      <div className="space-y-5">
        <CheckCircle2 size={32} />
        <h1 className="text-2xl font-semibold">{tx("You're on the team")}</h1>
        <p>
          {tx(
            "Your email is verified and bound to your sign-in wallet. Your workspace role is now active.",
          )}
        </p>
        <Link
          className="workspace-button workspace-button-primary"
          to={`/org/${joined}/dashboard`}
        >
          {tx("Open workspace")}
        </Link>
      </div>
    );
  if (valid && invitation === undefined)
    return <p role="status">{tx("Loading invitation…")}</p>;
  if (!valid || !invitation)
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">
          {tx("Invitation unavailable")}
        </h1>
        <p>
          {tx(
            "This link may have expired, been replaced or been revoked. Ask a workspace administrator for a new invitation.",
          )}
        </p>
        <Link className="workspace-action-link" to="/login">
          {tx("Sign in to Disburse")}
        </Link>
      </div>
    );
  const pending = invitation.status === "pending";
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">
        {pending
          ? tx("Join {{value1}}", { value1: invitation.organizationName })
          : tx("Invitation already accepted")}
      </h1>
      {error && <Notice>{tx(error)}</Notice>}
      {pending && (
        <>
          <p>
            {tx("Invited at")} {invitation.maskedEmail} {tx("· Expires")}{" "}
            {formatDate(invitation.expiresAt!)}
          </p>
          <section className="rounded-xl border border-white/10 p-4 space-y-2">
            <h2 className="font-semibold">{teamRoles[invitation.role!][0]}</h2>
            <p className="text-sm workspace-description">
              {teamRoles[invitation.role!][1]}
            </p>
          </section>
          <p className="text-sm workspace-description">
            {tx(
              "Accepting verifies this email invitation and binds it to the wallet you use to sign in. Workspace access does not give you ownership of a funding account.",
            )}
          </p>
        </>
      )}
      {signedIn ? (
        <>
          <div className="space-y-2">
            <span className="finance-label">
              {tx("Your verified sign-in wallet")}
            </span>
            <p className="font-mono text-sm break-all">
              {session.walletAddress}
            </p>
          </div>
          {pending && invitation.expectedWallet && (
            <p className="text-sm">
              {tx("This invitation requires")}{" "}
              <span className="font-mono break-all">
                {invitation.expectedWallet}
              </span>
              .
            </p>
          )}
          {pending && (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                disabled={busy}
                onChange={(e) =>
                  setConfirmedWallet(
                    e.target.checked ? session.walletAddress.toLowerCase() : "",
                  )
                }
              />
              {tx(
                "Use this wallet for my membership and accept the stated workspace role.",
              )}
            </label>
          )}
          <div className="flex flex-col items-start gap-4">
            <button
              className="workspace-button workspace-button-primary"
              disabled={
                busy ||
                (pending &&
                  (!confirmed ||
                    (!!invitation.expectedWallet &&
                      invitation.expectedWallet !==
                        session.walletAddress.toLowerCase())))
              }
              onClick={() => void join()}
            >
              {busy
                ? tx("Joining…")
                : pending
                  ? tx("Accept invitation")
                  : tx("Open my workspace")}
            </button>
            <button
              className="block workspace-action-link text-sm"
              disabled={busy}
              onClick={() => {
                setConfirmedWallet("");
                clearSessionToken();
                disconnect();
              }}
            >
              {tx("Use a different sign-in wallet")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="workspace-description">
            {tx(
              "Sign in to prove control of your wallet, then review and accept this invitation.",
            )}
          </p>
          <Link
            className="workspace-button workspace-button-primary"
            to="/login"
            state={{ returnTo: `/invite#${token}` }}
          >
            {tx("Sign in to continue")}
          </Link>
        </>
      )}
    </div>
  );
}
export default function AcceptInvitation() {
  useWorkspaceLanguage();
  const { hash } = useLocation(),
    { theme, setTheme } = useTheme();
  return (
    <div className="workspace workspace-entry min-h-screen px-5 py-10">
      <div className="mx-auto max-w-xl">
        <header className="gap-3 flex-wrap mb-8 flex items-center justify-between">
          <Link to="/" className="text-xl font-semibold">
            {tx("Disburse")}
          </Link>
          <LanguageSwitcher inline />
          <button
            className="workspace-button"
            aria-label={
              theme === "light"
                ? tx("Switch to dark theme")
                : tx("Switch to light theme")
            }
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>
        <main className="workspace-panel p-6 sm:p-8">
          <Invitation key={hash} token={hash.slice(1)} />
        </main>
      </div>
    </div>
  );
}
