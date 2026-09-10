import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import { useState } from "react";
import { Notice } from "@/components/workspace/WorkspacePrimitives";

/** Sharing creates a draft in the customer's email app. It never calls an
 * application-funded delivery API or marks a message as delivered. */
export function InvitationLink({ url, email }: { url: string; email: string }) {
  useWorkspaceLanguage();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const subject = tx("Your invitation to Disburse");
  const body = tx(
    "You have been invited to a workspace on Disburse.\n\nOpen this private link, sign in, and confirm the wallet you will use:\n{{url}}\n\nThe invitation expires in seven days. Please do not forward this link.",
    { url },
  );
  return (
    <div className="space-y-3 min-w-0">
      <label className="block">
        <span className="finance-label">{tx("Private invitation link")}</span>
        <input
          className="finance-field"
          value={url}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="workspace-button"
          onClick={async () => {
            setError("");
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setError(
                "The link could not be copied automatically. Select the link above and copy it.",
              );
            }
          }}
        >
          {copied ? tx("Link copied") : tx("Copy invitation link")}
        </button>
        <a
          className="workspace-button"
          href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
        >
          {tx("Open email draft")}
        </a>
      </div>
      <p className="workspace-description">
        {tx(
          "Share this private link with {{email}}. Disburse has not sent an email.",
          { email },
        )}
      </p>
      {error && <Notice>{tx(error)}</Notice>}
    </div>
  );
}
