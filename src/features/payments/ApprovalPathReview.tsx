import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import { useState } from "react";

export function ApprovalPathReview({
  paths,
  busy,
  onApprove,
  onCancel,
  subject = "payment",
}: {
  paths: Array<{ path: string[]; labels: string[] }>;
  busy: boolean;
  subject?: "payment" | "policy" | "cancellation";
  onApprove: (path: string[]) => void;
  onCancel: () => void;
}) {
  useWorkspaceLanguage();
  const [selected, setSelected] = useState(paths[0]?.path.join(":") ?? "");
  const choice = paths.find((p) => p.path.join(":") === selected);
  return (
    <section
      aria-label={tx("Choose approval account")}
      className="space-y-4 rounded-lg border border-[var(--ws-accent)] p-5"
    >
      <h3 className="font-semibold">
        {tx("Approve through a company account")}
      </h3>
      <p className="text-sm text-[var(--ws-muted)]">
        {subject === "cancellation"
          ? tx(
              "Your signature approves cancelling the original transaction. Each owning account must collect its required approvals. Cancellation takes effect after the account confirms it.",
            )
          : subject === "policy"
            ? tx(
                "Your signature approves this spending policy for the selected account. Each owning account must collect its required approvals before the change can be applied.",
              )
            : tx(
                "Your signature approves this payment from the funding account. Each owning account must collect its own required approvals. Funds leave only the funding account when the payment is sent.",
              )}
      </p>
      <fieldset className="space-y-2">
        <legend className="sr-only">{tx("Approval path")}</legend>
        {paths.map((p) => (
          <label
            key={p.path.join(":")}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--ws-border)] p-3 text-sm"
          >
            <input
              type="radio"
              name="approval-path"
              checked={selected === p.path.join(":")}
              disabled={busy}
              onChange={() => setSelected(p.path.join(":"))}
            />
            <span>
              <strong>
                {p.labels.length > 1
                  ? p.labels[p.labels.length - 1]
                  : tx("Direct approval")}
              </strong>
              <span className="mt-1 block text-[var(--ws-muted)]">
                {[...p.labels].reverse().join(" → ")}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button
          className="workspace-button workspace-button-primary"
          disabled={busy || !choice}
          onClick={() => choice && onApprove(choice.path)}
        >
          {busy ? tx("Waiting for wallet…") : tx("Confirm approval in wallet")}
        </button>
        <button className="workspace-button" disabled={busy} onClick={onCancel}>
          {tx("Back to")} {subject}
        </button>
      </div>
    </section>
  );
}
