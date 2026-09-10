import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import { userErrorMessage } from "@/lib/userErrors";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { formatDate } from "@/lib/formatMoney";

const labels: Record<string, string> = {
  requested: "Awaiting details",
  submitted: "Submitted · awaiting review",
  approved: "Reviewed and approved",
  rejected: "Details rejected",
  withdrawn: "Review withdrawn",
  expired: "Link expired",
  revoked: "Link revoked",
  changed: "Recipient changed · new link needed",
  unavailable: "Request unavailable",
};

export function RecipientCollection({
  beneficiaryId,
  name,
}: {
  beneficiaryId: Id<"beneficiaries">;
  name: string;
}) {
  useWorkspaceLanguage();
  const sessionToken = useSessionToken();
  const { environment } = useActivityEnvironment();
  const history = useQuery(
    api.recipientCollections.history,
    sessionToken ? { beneficiaryId, sessionToken } : "skip",
  );
  const create = useAction(api.recipientCollectionActions.create);
  const revoke = useMutation(api.recipientCollections.revoke);
  const [link, setLink] = useState<{ url: string; requestId: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const latest = history?.requests[0];
  const canShare =
    !!link && latest?.id === link.requestId && latest.state === "requested";
  const run = async (task: () => Promise<void>) => {
    if (busy || !sessionToken) return;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(
        userErrorMessage(e, "Could not update this payment detail request."),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label={tx("Collect payment details")}
      className="rounded-xl border border-white/10 bg-navy-800/30 p-4 space-y-3"
    >
      <div>
        <h2 className="font-semibold">
          {tx("Let {{name}} add their payment details", { name })}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {tx(
            "Share a private form. Submitted details need your team’s review before payment.",
          )}
        </p>
      </div>
      {history === undefined && (
        <p role="status" className="text-sm text-slate-400">
          {tx("Checking detail requests…")}
        </p>
      )}
      {error && <Notice>{tx(error)}</Notice>}
      {latest && (
        <p className="text-sm">
          <strong>{tx(labels[latest.state])}</strong>
          {latest.state === "requested"
            ? tx(" · Expires {{value1}}", {
                value1: formatDate(latest.expiresAt),
              })
            : latest.submittedAt
              ? tx(" · Received {{value1}}", {
                  value1: formatDate(latest.submittedAt),
                })
              : ""}
        </p>
      )}
      {canShare && (
        <div className="space-y-3">
          <label className="block">
            <span className="finance-label">
              {tx("Private payment details link")}
            </span>
            <input
              className="finance-field text-xs"
              readOnly
              value={link.url}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <p className="text-xs text-slate-400">
            {tx(
              "Anyone with this link can submit details for {{name}}. Send it through a contact channel you already trust. Disburse has not sent a message.",
              { name },
            )}
          </p>
          <button
            type="button"
            className="workspace-button"
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(link.url);
                setCopied(true);
              })
            }
          >
            {copied ? tx("Link copied") : tx("Copy link")}
          </button>
        </div>
      )}
      {history?.canCreate && environment !== "unclassified" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="workspace-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await create({
                  beneficiaryId,
                  sessionToken: sessionToken!,
                  environment,
                });
                setLink({
                  url: `${window.location.origin}/recipient-details#${result.token}`,
                  requestId: result.requestId,
                });
                setCopied(false);
              })
            }
          >
            {busy
              ? tx("Updating…")
              : latest?.state === "requested"
                ? tx("Replace link")
                : tx("Create details link")}
          </button>
          {latest?.state === "requested" && (
            <button
              type="button"
              className="workspace-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await revoke({
                    requestId: latest.id,
                    sessionToken: sessionToken!,
                  });
                  setLink(null);
                })
              }
            >
              {tx("Revoke link")}
            </button>
          )}
        </div>
      )}
      {history?.canCreate && environment === "unclassified" && (
        <p className="text-sm workspace-funding-warning">
          {tx("Choose Business or Test activity before creating a request.")}
        </p>
      )}
      {latest?.state === "requested" && !link && (
        <p className="text-xs text-slate-400">
          {tx(
            "The original link is only shown when created. Replace it to get a new link; the previous link will stop accepting details.",
          )}
        </p>
      )}
      {environment === "test" && (
        <p className="text-xs workspace-funding-warning">
          {tx("Test activity · this form will request a test payment address.")}
        </p>
      )}
      {!!history && history.requests.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer">{tx("Request history")}</summary>
          <ul className="mt-2 space-y-2">
            {history.requests.map((r) => (
              <li key={r.id}>
                <span>{tx(labels[r.state])}</span>
                <span className="text-slate-400">
                  {" "}
                  {tx("· Created")} {formatDate(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
