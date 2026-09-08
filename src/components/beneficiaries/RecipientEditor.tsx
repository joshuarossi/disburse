import { userErrorMessage } from '@/lib/userErrors';
import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { CHAINS_LIST, getTokenSymbolsForChain } from "@/lib/chains";
import { RecipientCollection } from "./RecipientCollection";
import { RecipientScreening } from "./ScreeningEvidence";
export function RecipientEditor({
  orgId,
  recipient,
  onClose,
  readOnly = false,
}: {
  orgId: Id<"orgs">;
  recipient?: Doc<"beneficiaries"> & { tags?: string[] };
  onClose: () => void;
  readOnly?: boolean;
}) {
  const sessionToken = useSessionToken();
  const create = useMutation(api.beneficiaries.create);
  const update = useMutation(api.beneficiaries.update);
  const [name, setName] = useState(recipient?.name ?? "");
  const [email, setEmail] = useState(recipient?.email ?? "");
  const [type, setType] = useState<"individual" | "business">(
    recipient?.type ?? "individual",
  );
  const [address, setAddress] = useState(recipient?.walletAddress ?? "");
  const [notes, setNotes] = useState(recipient?.notes ?? "");
  const [groups, setGroups] = useState(recipient?.tags?.join(", ") ?? "");
  const [chain, setChain] = useState(
    recipient?.preferredChainId?.toString() ?? "",
  );
  const [token, setToken] = useState(recipient?.preferredToken ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmedAddress, setConfirmedAddress] = useState(false);
  const addressChanged =
    !!recipient?.walletAddress &&
    address.trim().toLowerCase() !== recipient.walletAddress.toLowerCase();
  const instructionsChanged =
    addressChanged ||
    token !== (recipient?.preferredToken ?? "") ||
    chain !== (recipient?.preferredChainId?.toString() ?? "");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionToken || busy || readOnly) return;
    if (recipient?.walletAddress && !address.trim()) {
      setError(
        "Enter a replacement payout address, or keep the saved address. Archive this recipient if they should no longer receive payments.",
      );
      return;
    }
    if (addressChanged && !confirmedAddress) {
      setError(
        "Confirm the address change before requesting review. Saved instructions stay unchanged until the review is approved.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fields = {
        sessionToken,
        name: name.trim(),
        email: email.trim(),
        type,
        notes: notes.trim(),
        tags: groups
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean),
        preferredToken: token || undefined,
        preferredChainId: chain ? Number(chain) : undefined,
      };
      if (recipient)
        await update({
          ...fields,
          preferredToken: token || null,
          preferredChainId: chain ? Number(chain) : null,
          beneficiaryId: recipient._id,
          beneficiaryAddress: address.trim() || undefined,
        });
      else
        await create({
          ...fields,
          orgId,
          beneficiaryAddress: address.trim(),
          allowMissingPaymentDetails: true,
        });
      onClose();
    } catch (e) {
      setError(userErrorMessage(e, "Could not save recipient"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={
        recipient
          ? readOnly
            ? "Recipient details"
            : "Edit recipient"
          : "Add a recipient"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="space-y-5 p-6" onSubmit={save}>
        {error && <Notice>{error}</Notice>}
        {recipient?.pendingPayoutChangeId && (
          <Notice tone="info">
            Payout details are awaiting review. Review or withdraw that request
            from Recipients before making another change.
          </Notice>
        )}
        <p className="workspace-description !mt-0">
          Save their details once. Use this recipient for payroll, bills, and
          future payments.
        </p>
        <fieldset disabled={busy || readOnly} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="finance-label">Recipient type</span>
              <select
                className="finance-field"
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                <option value="individual">Person</option>
                <option value="business">Business</option>
              </select>
            </label>
            <label>
              <span className="finance-label">
                {type === "business" ? "Business name" : "Full name"}
              </span>
              <input
                className="finance-field"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="finance-label">Email address</span>
              <input
                className="finance-field"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
              />
            </label>
            <label>
              <span className="finance-label">Groups</span>
              <input
                className="finance-field"
                value={groups}
                onChange={(e) => setGroups(e.target.value)}
                placeholder="Payroll, Contractors"
              />
              <span className="workspace-table-secondary">
                Separate groups with commas
              </span>
            </label>
          </div>
          <div className="border-t border-white/10 pt-5">
            <h3 className="mb-2 text-sm font-semibold">Payment details</h3>
            <p className="workspace-description !mt-0 mb-4">
              You can add these later if you have an email address. Confirm the
              payout details with the recipient before their first payment. New
              or changed instructions go through payout review before they can
              be used.
            </p>
            <label>
              <span className="finance-label">Payout address</span>
              <input
                className="finance-field font-mono"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setConfirmedAddress(false);
                }}
                placeholder="0x…"
                spellCheck={false}
              />
            </label>
            {addressChanged && (
              <label className="mt-3 flex items-start gap-2 text-xs leading-5">
                <input
                  type="checkbox"
                  checked={confirmedAddress}
                  onChange={(e) => setConfirmedAddress(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Request review of this replacement address. The currently
                  approved instructions stay unchanged until approval.
                </span>
              </label>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label>
                <span className="finance-label">Preferred network</span>
                <select
                  className="finance-field"
                  value={chain}
                  onChange={(e) => {
                    setChain(e.target.value);
                    setToken("");
                  }}
                >
                  <option value="">Choose when paying</option>
                  {CHAINS_LIST.map((c) => (
                    <option value={c.chainId} key={c.chainId}>
                      {c.chainName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="finance-label">Preferred currency</span>
                <select
                  className="finance-field"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                >
                  <option value="">Choose when paying</option>
                  {(chain
                    ? getTokenSymbolsForChain(Number(chain))
                    : ["USDC", "USDT", "PYUSD"]
                  ).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <label className="block">
            <span className="finance-label">Internal notes</span>
            <textarea
              className="finance-field"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Details your team should know"
            />
          </label>
        </fieldset>
        {recipient?.isActive && (
          <RecipientCollection
            beneficiaryId={recipient._id}
            name={recipient.name}
          />
        )}
        {recipient && (
          <RecipientScreening
            beneficiaryId={recipient._id}
            beneficiaryName={recipient.name}
          />
        )}
        <div className="flex justify-end gap-2 border-t border-white/10 pt-5">
          <button
            type="button"
            className="workspace-button"
            disabled={busy}
            onClick={onClose}
          >
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <button
              className="workspace-button workspace-button-primary"
              disabled={busy}
            >
              {busy
                ? "Saving…"
                : recipient
                  ? instructionsChanged
                    ? "Request payout review"
                    : "Save changes"
                  : "Add recipient"}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
