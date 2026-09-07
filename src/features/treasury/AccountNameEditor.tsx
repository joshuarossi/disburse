import { userErrorMessage } from '@/lib/userErrors';
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { useQueryClient } from "@tanstack/react-query";
import { getChainName } from "@/lib/chains";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/button";

export function AccountNameEditor({
  account,
  onClose,
}: {
  account: Doc<"safes">;
  onClose: () => void;
}) {
  const [name, setName] = useState(
    account.name ?? `${getChainName(account.chainId)} account`,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rename = useMutation(api.safes.rename);
  const sessionToken = useSessionToken();
  const queryClient = useQueryClient();
  return (
    <Dialog
      title="Name this account"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form
        className="space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving || !sessionToken) return;
          setSaving(true);
          setError("");
          try {
            await rename({ safeId: account._id, sessionToken, name });
            await queryClient.invalidateQueries({
              queryKey: ["account-readiness", account._id],
            });
            onClose();
          } catch (e) {
            setError(
              userErrorMessage(e, "Could not save the account name. Try again."),
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <p className="workspace-description">
          Use a name your team recognizes, such as Payroll or Operating account.
        </p>
        <label className="block">
          <span className="finance-label">Account name</span>
          <input
            data-autofocus
            className="finance-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </label>
        <p className="text-xs text-slate-400">
          {getChainName(account.chainId)} ·{" "}
          <span className="break-all font-mono">{account.safeAddress}</span>
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save account name"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
