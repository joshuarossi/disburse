import { tx, useWorkspaceLanguage } from "@/lib/workspaceI18n";
import { userErrorMessage } from "@/lib/userErrors";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ShieldCheck } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingRows } from "@/components/workspace/WorkspacePrimitives";

export function MemberSpendingLimits({
  orgId,
  isAdmin,
}: {
  orgId: Id<"orgs">;
  isAdmin: boolean;
}) {
  useWorkspaceLanguage();
  const sessionToken = useSessionToken();
  const members = useQuery(
    api.orgs.listMembers,
    sessionToken ? { orgId, sessionToken } : "skip",
  );
  const update = useMutation(api.memberPolicies.update);
  const [selected, setSelected] = useState<Id<"orgMemberships"> | null>(null);
  const [token, setToken] = useState("USDC");
  const [perPayment, setPerPayment] = useState("");
  const [perMonth, setPerMonth] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (remove = false) => {
    if (!sessionToken || !selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await update({
        membershipId: selected,
        sessionToken,
        policy: remove
          ? null
          : {
              token,
              perPayment: perPayment || undefined,
              perMonth: perMonth || undefined,
            },
      });
      setSelected(null);
    } catch (e) {
      setError(userErrorMessage(e, "Could not update payment limits"));
    } finally {
      setBusy(false);
    }
  };
  if (!members) return <LoadingRows />;
  return (
    <section className="finance-panel overflow-hidden">
      <div className="border-b border-white/10 p-5">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <ShieldCheck className="h-4 w-4 text-accent-400" />
          {tx("Member spending limits")}
        </h2>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          {tx(
            "Set how much a member may create through Disburse. Drafts and pending payments reserve their allowance for the planned payment month. Cancelling a payment releases it.",
          )}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="finance-table">
          <thead>
            <tr>
              <th>{tx("Member")}</th>
              <th>{tx("Allowed currency")}</th>
              <th>{tx("Per payment")}</th>
              <th>{tx("Per month")}</th>
              <th>
                <span className="sr-only">{tx("Manage limits")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members
              ?.filter(
                (member) =>
                  member?.status === "active" &&
                  ["admin", "approver", "initiator"].includes(member.role),
              )
              .map(
                (member) =>
                  member && (
                    <tr key={member.membershipId}>
                      <td>
                        {member.name ||
                          `${member.walletAddress.slice(0, 6)}…${member.walletAddress.slice(-4)}`}
                      </td>
                      <td>
                        {member.paymentPolicy?.token ?? tx("All supported")}
                      </td>
                      <td className="tabular-nums">
                        {member.paymentPolicy?.perPayment ?? tx("No limit")}
                      </td>
                      <td className="tabular-nums">
                        {member.paymentPolicy?.perMonth ?? tx("No limit")}
                      </td>
                      <td>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelected(member.membershipId);
                              setToken(member.paymentPolicy?.token ?? "USDC");
                              setPerPayment(
                                member.paymentPolicy?.perPayment ?? "",
                              );
                              setPerMonth(member.paymentPolicy?.perMonth ?? "");
                              setError("");
                            }}
                          >
                            {tx("Edit limits")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ),
              )}
          </tbody>
        </table>
      </div>
      <p className="border-t border-white/10 px-5 py-4 text-xs leading-5 text-slate-500">
        {tx(
          "These are application limits. They do not change who can sign for the funding account. Existing Safe owners retain their on-chain authority, including transactions outside Disburse. Monthly allowances use UTC pay dates.",
        )}
      </p>
      {selected && (
        <Dialog
          title={tx("Member spending limits")}
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <div className="p-6">
            {error && (
              <p role="alert" className="mb-4 text-sm text-red-400">
                {tx(error)}
              </p>
            )}
            <div className="grid gap-5">
              <label>
                <span className="finance-label">
                  {tx("Allowed payment currency")}
                </span>
                <select
                  className="finance-field"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                >
                  {["USDC", "USDT", "PYUSD", "EURC"].map((token) => (
                    <option key={token}>{token}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="finance-label">
                  {tx("Maximum per payment")}
                </span>
                <input
                  className="finance-field"
                  inputMode="decimal"
                  placeholder={tx("No limit")}
                  value={perPayment}
                  onChange={(e) => setPerPayment(e.target.value)}
                />
              </label>
              <label>
                <span className="finance-label">{tx("Monthly allowance")}</span>
                <input
                  className="finance-field"
                  inputMode="decimal"
                  placeholder={tx("No limit")}
                  value={perMonth}
                  onChange={(e) => setPerMonth(e.target.value)}
                />
              </label>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-400">
              {tx(
                "Limits apply to the total batch, not each recipient. Changing a policy does not cancel payments already submitted. Admins can change or remove these limits.",
              )}
            </p>
            <div className="mt-6 flex justify-between gap-3">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => save(true)}
              >
                {tx("Remove policy")}
              </Button>
              <Button disabled={busy} onClick={() => save()}>
                {busy ? tx("Saving...") : tx("Save limits")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
