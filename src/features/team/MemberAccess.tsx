import { tx, useWorkspaceLanguage, workspaceLocale } from "@/lib/workspaceI18n";
import { useState } from "react";
import { useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { RefreshCw } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { chainEnvironment } from "../../../shared/assets";
import { useSessionToken } from "@/lib/session";
import { getChainName, getTokensForChain } from "@/lib/chains";
import { formatMoney } from "@/lib/formatMoney";
import {
  ALLOWANCE_PERIODS,
  getAllowanceDeployments,
  readAllowanceSnapshot,
  type AllowanceDeployment,
} from "@/lib/safeAllowance";
import { useAccountReadiness } from "@/features/treasury/useAccountReadiness";
import { Dialog } from "@/components/ui/Dialog";
import {
  LoadingRows,
  Notice,
} from "@/components/workspace/WorkspacePrimitives";
import { roles, type TeamMember } from "./memberTypes";
import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";

const canPay = (member: TeamMember) =>
  member.status === "active" &&
  ["admin", "approver", "initiator"].includes(member.role);
type FundingAccount = {
  _id: Id<"safes">;
  safeAddress: string;
  chainId: number;
  name?: string;
};
const accountName = (safe: FundingAccount) =>
  safe.name || `${getChainName(safe.chainId)} account`;
const environmentLabel = (chainId: number) =>
  ({ production: "Business", test: "Test", unclassified: "Unclassified" })[
    chainEnvironment(chainId)
  ];

export function MemberAccess({
  orgId,
  membershipId,
  onClose,
  onManage,
}: {
  orgId: Id<"orgs">;
  membershipId: Id<"orgMemberships">;
  onClose: () => void;
  onManage?: (tab: "limits" | "delegation") => void;
}) {
  useWorkspaceLanguage();
  const sessionToken = useSessionToken();
  const { environment } = useActivityEnvironment();
  const args = sessionToken ? { orgId, sessionToken } : "skip";
  const members = useConvexQuery(api.orgs.listMembers, args);
  const accounts = useConvexQuery(api.safes.getForOrg, args);
  const member = members?.find((m) => m?.membershipId === membershipId);
  const [accountId, setAccountId] = useState("");
  const activeAccounts = accounts?.filter((s) => s.isActive !== false);
  const account =
    activeAccounts?.find((s) => s._id === accountId) ??
    activeAccounts?.find((s) => chainEnvironment(s.chainId) === environment) ??
    activeAccounts?.[0];
  const paymentRights = member ? canPay(member) : false;
  const policy = member?.paymentPolicy;
  const limit = (value: string | undefined) =>
    value && policy
      ? `${formatMoney(value, policy.token, true)} ${policy.token}`
      : "No app limit";
  return (
    <Dialog
      title={tx("Access for {{value1}}", {
        value1: member?.name || "team member",
      })}
      onClose={onClose}
    >
      <div className="space-y-6 p-5 sm:p-6">
        {!members ? (
          <LoadingRows />
        ) : !member ? (
          <Notice>{tx("This membership is no longer available.")}</Notice>
        ) : (
          <>
            <div>
              <p className="font-semibold">{tx(roles[member.role][0])}</p>
              <p className="workspace-description mt-1">
                {tx(roles[member.role][1])}
              </p>
              <details className="mt-3 text-xs text-slate-400">
                <summary className="cursor-pointer">
                  {tx("Sign-in identity")}
                </summary>
                <p className="mt-2 break-all font-mono">
                  {member.walletAddress}
                </p>
                <p className="mt-1">
                  {member.email || tx("No email added")}
                  {member.emailVerifiedAt ? tx(" · Email verified") : ""}
                </p>
              </details>
            </div>
            {member.status !== "active" && (
              <Notice tone="info">
                {member.status === "invited"
                  ? tx("No workspace access until this invitation is accepted.")
                  : tx("Workspace access is inactive.")}{" "}
                {tx(
                  "Existing account ownership and spending grants still need a separate review.",
                )}
              </Notice>
            )}
            <section
              aria-label={tx("Payment permissions")}
              className="space-y-3"
            >
              <h3 className="font-semibold">{tx("Payments in Disburse")}</h3>
              <dl className="divide-y divide-white/10 text-sm">
                {[
                  [
                    "Prepare payments",
                    paymentRights ? "Allowed within app limits" : "Not allowed",
                  ],
                  [
                    "Sign approvals",
                    paymentRights
                      ? "On accounts they own"
                      : "Not allowed through this role",
                  ],
                  [
                    "Send payments",
                    paymentRights
                      ? "After account approvals, or using a spending grant"
                      : "Not allowed through this role",
                  ],
                ].map(([label, value]) => (
                  <div
                    key={tx(label)}
                    className="grid gap-1 py-3 sm:grid-cols-[150px_1fr]"
                  >
                    <dt className="text-slate-400">{tx(label)}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section
              aria-label={tx("App payment limits")}
              className="rounded-xl border border-white/10 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">{tx("App payment limits")}</h3>
                {onManage && (
                  <button
                    className="workspace-button"
                    onClick={() => onManage("limits")}
                  >
                    {tx("Manage limits")}
                  </button>
                )}
              </div>
              <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                {[
                  ["Allowed currency", policy?.token || "All supported"],
                  ["Per payment", limit(policy?.perPayment)],
                  ["Per UTC month", limit(policy?.perMonth)],
                ].map(([label, value]) => (
                  <div key={tx(label)}>
                    <dt className="text-xs text-slate-400">{tx(label)}</dt>
                    <dd className="mt-1 text-sm font-medium tabular-nums">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs leading-5 text-slate-400">
                {tx(
                  "These limits apply across the workspace's accounts to payments this member creates or sends as a delegate, including reviewed fees. Drafts, pending payments and completed payments count toward the planned UTC month; cancellation releases the amount. Account-owner approvals do not have a separate app budget.",
                )}
              </p>
              {!paymentRights && (
                <p className="mt-2 text-xs text-slate-400">
                  {tx(
                    "A saved limit does not give this role permission to prepare or send payments.",
                  )}
                </p>
              )}
            </section>
            <section aria-label={tx("Account authority")} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">{tx("Account authority")}</h3>
                {onManage && (
                  <button
                    className="workspace-button"
                    onClick={() => onManage("delegation")}
                  >
                    {tx("Manage spending grants")}
                  </button>
                )}
              </div>
              <p className="workspace-description">
                {tx(
                  "Choose an account to check current ownership and spending grants. Business and test accounts are labelled separately.",
                )}
              </p>
              {!activeAccounts ? (
                <LoadingRows />
              ) : !account ? (
                <p className="workspace-description">
                  {tx("No active funding accounts are connected.")}
                </p>
              ) : (
                <>
                  <label className="block">
                    <span className="finance-label">
                      {tx("Account to review")}
                    </span>
                    <select
                      className="finance-field"
                      value={account._id}
                      onChange={(e) => setAccountId(e.target.value)}
                    >
                      {activeAccounts.map((s) => (
                        <option key={s._id} value={s._id}>
                          {accountName(s)}
                          {s.name ? ` · ${getChainName(s.chainId)}` : ""} ·{" "}
                          {environmentLabel(s.chainId)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <AccountAuthority
                    key={`${account._id}:${member.walletAddress}`}
                    account={account}
                    member={member}
                    assignedAccounts={
                      accounts?.filter(
                        (s) =>
                          s.assignedUserId === member.userId &&
                          s.chainId === account.chainId,
                      ) ?? []
                    }
                  />
                </>
              )}
            </section>
            <p className="border-t border-white/10 pt-4 text-xs leading-5 text-slate-400">
              {tx(
                "Workspace roles and app limits do not remove account authority. Account owners can act outside Disburse, and spending grants allow transfers to any address. Removing a member does not revoke ownership or a grant.",
              )}
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}

function AccountAuthority({
  account,
  member,
  assignedAccounts,
}: {
  account: FundingAccount;
  member: TeamMember;
  assignedAccounts: FundingAccount[];
}) {
  useWorkspaceLanguage();
  const readiness = useAccountReadiness(account._id);
  const data = readiness.data;
  const error =
    readiness.isError ||
    data?.error ||
    (data && Date.now() - data.checkedAt > 120_000);
  const owner =
    !error &&
    data?.owners.some(
      (o) => o.address.toLowerCase() === member.walletAddress.toLowerCase(),
    );
  const modules = getAllowanceDeployments(account.chainId);
  return (
    <div className="space-y-4">
      <p className="break-all font-mono text-xs text-slate-400">
        {account.safeAddress}
      </p>
      <div className="rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">{tx("Approval authority")}</h4>
          <button
            aria-label={tx("Refresh account authority")}
            className="workspace-button"
            disabled={readiness.isFetching}
            onClick={() => void readiness.refetch()}
          >
            <RefreshCw size={14} />
            <span>{tx("Refresh")}</span>
          </button>
        </div>
        {readiness.isPending ? (
          <p role="status" className="mt-3 text-sm text-slate-400">
            {tx("Checking current account owners…")}
          </p>
        ) : error ? (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {tx(
              "Account authority could not be verified. Refresh before relying on this summary.",
            )}
          </p>
        ) : (
          data && (
            <>
              <p className="mt-3 text-sm">
                {owner
                  ? canPay(member)
                    ? tx("Can sign for this account")
                    : tx(
                        "Account owner · Cannot sign through this workspace role",
                      )
                  : tx("Not an account owner")}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                {data.threshold} {tx("of")} {data.owners.length}{" "}
                {tx(
                  "account owners must approve each owner-authorized payment.",
                )}
                {owner && data.threshold && data.threshold > 1
                  ? tx(" This member cannot authorize a payment alone.")
                  : ""}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                {tx("Checked")}{" "}
                {new Date(data.checkedAt).toLocaleTimeString(workspaceLocale())}{" "}
                {tx("· Block")} {data.blockNumber}
              </p>
            </>
          )
        )}
      </div>
      {!error && data && (
        <>
          <h4 className="text-sm font-semibold">
            {tx("Spending without owner approvals")}
          </h4>
          {!modules.length ? (
            <p className="workspace-description">
              {tx(
                "No supported spending module is configured for this network.",
              )}
            </p>
          ) : (
            modules.map((module) => (
              <MemberGrants
                key={module.address}
                account={account}
                member={member}
                module={module}
                assignedAccounts={assignedAccounts}
              />
            ))
          )}
          <p className="text-xs leading-5 text-slate-400">
            {tx(
              "Each grant is separate. Available allowance is a contract limit, not an account balance or a reservation of funds. Payment and fee checks still apply. This review covers supported Safe allowance versions; other installed modules require a separate review.",
            )}
          </p>
        </>
      )}
    </div>
  );
}

function MemberGrants({
  account,
  member,
  module,
  assignedAccounts,
}: {
  account: FundingAccount;
  member: TeamMember;
  module: AllowanceDeployment;
  assignedAccounts: FundingAccount[];
}) {
  useWorkspaceLanguage();
  const [selectedDelegate, setDelegate] = useState("");
  const delegate =
    selectedDelegate ||
    (!module.legacy && assignedAccounts[0]?.safeAddress) ||
    member.walletAddress;
  const snapshot = useQuery({
    queryKey: [
      "member-allowances",
      account.chainId,
      account.safeAddress,
      module.address,
      delegate,
    ],
    queryFn: () =>
      readAllowanceSnapshot(
        account.chainId,
        account.safeAddress,
        module.address,
        delegate,
      ),
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  const tokens = Object.values(getTokensForChain(account.chainId));
  const registered = snapshot.data?.delegates.some(
    (d) => d.toLowerCase() === delegate.toLowerCase(),
  );
  return (
    <section
      aria-label={tx("Spending grants version {{value1}}", {
        value1: module.version,
      })}
      className="space-y-3 rounded-xl border border-white/10 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h5 className="text-sm font-medium">
          {module.legacy
            ? tx("Legacy spending grants")
            : tx("Current spending grants")}{" "}
          <span className="text-xs font-normal text-slate-400">
            · {module.version}
          </span>
        </h5>
        <button
          className="workspace-button"
          aria-label={tx("Refresh grants version {{value1}}", {
            value1: module.version,
          })}
          disabled={snapshot.isFetching}
          onClick={() => void snapshot.refetch()}
        >
          <RefreshCw size={14} />
          <span>{tx("Refresh")}</span>
        </button>
      </div>
      {!!assignedAccounts.length && (
        <label className="block">
          <span className="finance-label">{tx("Spending identity")}</span>
          <select
            className="finance-field"
            value={delegate}
            onChange={(e) => setDelegate(e.target.value)}
          >
            {assignedAccounts.map((s) => (
              <option key={s._id} value={s.safeAddress}>
                {accountName(s)}
              </option>
            ))}
            <option value={member.walletAddress}>
              {tx("Signing wallet · earlier grants")}
            </option>
          </select>
        </label>
      )}
      {snapshot.isPending ? (
        <p role="status" className="text-sm text-slate-400">
          {tx("Checking this member's spending grants…")}
        </p>
      ) : snapshot.isError ? (
        <p role="alert" className="text-sm text-red-400">
          {tx("Spending grants could not be verified. Refresh to retry.")}
        </p>
      ) : (
        snapshot.data && (
          <>
            {!snapshot.data.allowances.length ? (
              <p className="text-sm text-slate-400">
                {tx("No grants recorded for this member in this version.")}
              </p>
            ) : (
              <>
                {module.legacy && (
                  <Notice>
                    {tx(
                      "This older module has a known replay vulnerability. Replace these grants before sending through Disburse. Existing on-chain authority remains until owners revoke it.",
                    )}
                  </Notice>
                )}
                {(!snapshot.data.moduleEnabled || !registered) && (
                  <p className="text-sm text-amber-500">
                    {tx("These grants are dormant:")}{" "}
                    {snapshot.data.moduleEnabled
                      ? tx("the delegate is not registered")
                      : tx("the module is disabled")}
                    {tx(". They currently permit no transfers.")}
                  </p>
                )}
                {snapshot.data.allowances.map((grant) => {
                  const token = tokens.find(
                    (t) =>
                      t.address.toLowerCase() === grant.token.toLowerCase(),
                  );
                  const show = (amount: bigint) =>
                    token
                      ? `${formatMoney(formatUnits(amount, token.decimals), token.symbol, true)} ${token.symbol}`
                      : `${amount} base units`;
                  const exhausted = grant.nonce >= 65535n;
                  const available =
                    snapshot.data!.moduleEnabled &&
                    registered &&
                    !exhausted &&
                    grant.amount > grant.spent
                      ? grant.amount - grant.spent
                      : 0n;
                  return (
                    <div
                      key={grant.token}
                      className="space-y-2 border-t border-white/10 pt-3 text-sm"
                    >
                      <p className="font-medium">
                        {show(available)} {tx("available under this grant")}
                      </p>
                      <p className="text-xs text-slate-400">
                        {tx("Limit")} {show(grant.amount)} ·{" "}
                        {tx(
                          ALLOWANCE_PERIODS.find(
                            (p) => p.minutes === grant.resetMinutes,
                          )?.label ??
                            tx("Every {{value1}} minutes", {
                              value1: grant.resetMinutes,
                            }),
                        )}
                      </p>
                      {grant.resetMinutes > 0 && (
                        <p className="text-xs text-slate-400">
                          {tx("Next reset:")}{" "}
                          {new Date(
                            (grant.lastResetMinutes + grant.resetMinutes) *
                              60_000,
                          ).toLocaleString(workspaceLocale())}
                        </p>
                      )}
                      {!token && (
                        <p className="break-all text-xs text-slate-400">
                          {tx("Unrecognized token:")} {grant.token}
                          {tx(
                            ". This currency cannot be paid through Disburse.",
                          )}
                        </p>
                      )}
                      {exhausted && (
                        <p className="text-xs text-amber-500">
                          {tx(
                            "This grant has exhausted its transfer counter. A new delegate is required.",
                          )}
                        </p>
                      )}
                      {!canPay(member) && (
                        <p className="text-xs text-slate-400">
                          {tx(
                            "This workspace role cannot use the grant in Disburse.",
                          )}
                        </p>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            <p className="text-xs text-slate-400">
              {tx("Checked at block")} {snapshot.data.blockNumber.toString()}
            </p>
          </>
        )
      )}
    </section>
  );
}
