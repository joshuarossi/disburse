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
  const [selected, setSelected] = useState(paths[0]?.path.join(":") ?? "");
  const choice = paths.find((p) => p.path.join(":") === selected);
  return (
    <section
      aria-label="Choose approval account"
      className="space-y-4 rounded-lg border border-[var(--ws-accent)] p-5"
    >
      <h3 className="font-semibold">Approve through a company account</h3>
      <p className="text-sm text-[var(--ws-muted)]">
        {subject === "cancellation" ? "Your signature approves cancelling the original transaction. Each owning account must collect its required approvals. Cancellation takes effect after the account confirms it." : subject === "policy"
          ? "Your signature approves this spending policy for the selected account. Each owning account must collect its required approvals before the change can be applied."
          : "Your signature approves this payment from the funding account. Each owning account must collect its own required approvals. Funds leave only the funding account when the payment is sent."}
      </p>
      <fieldset className="space-y-2">
        <legend className="sr-only">Approval path</legend>
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
                  : "Direct approval"}
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
          {busy ? "Waiting for wallet…" : "Confirm approval in wallet"}
        </button>
        <button className="workspace-button" disabled={busy} onClick={onCancel}>
          Back to {subject}
        </button>
      </div>
    </section>
  );
}
