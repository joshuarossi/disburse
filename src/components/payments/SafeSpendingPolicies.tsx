import { supportsCircleFees } from "../../../shared/circleExecution";
import { userErrorMessage } from "@/lib/userErrors";
import { useState } from "react";
import { PolicyApprovalQueue } from "./PolicyApprovalQueue";
import { useAction, useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { ShieldCheck, ExternalLink } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { formatMoney } from "@/lib/formatMoney";
import { getChainName, getSafeAppUrl, getTokensForChain } from "@/lib/chains";
import {
  ALLOWANCE_PERIODS,
  getAllowanceDeployments,
  readAllowanceSnapshot,
  type OnchainAllowance,
} from "@/lib/safeAllowance";
import { RELAY_FEATURE_ENABLED } from "@/lib/relayConfig";
import { feeIdentity } from "../../../shared/executionFee";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/Dialog";
import { supportsCurrentAllowance } from "../../../shared/allowanceDeployments";
import { chainEnvironment } from "../../../shared/assets";
import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";

const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

export function SafeSpendingPolicies({
  orgId,
  isAdmin,
}: {
  orgId: Id<"orgs">;
  isAdmin: boolean;
}) {
  const sessionToken = useSessionToken();
  const { environment } = useActivityEnvironment();
  const { address } = useAccount();
  const createPolicy = useAction(api.spendingPolicies.create);
  const safes = useConvexQuery(
    api.safes.getForOrg,
    sessionToken ? { orgId, sessionToken, includeArchived: true } : "skip",
  );
  const members = useConvexQuery(
    api.orgs.listMembers,
    sessionToken ? { orgId, sessionToken } : "skip",
  );
  const [safeId, setSafeId] = useState("");
  const [moduleAddress, setModuleAddress] = useState("");
  const safe =
    safes?.find((s) => s._id === safeId) ??
    safes?.find(
      (s) =>
        s.isActive !== false && chainEnvironment(s.chainId) === environment,
    ) ??
    safes?.[0];
  const deployments = getAllowanceDeployments(safe?.chainId ?? 0);
  const module =
    deployments.find((d) => d.address === moduleAddress) ?? deployments[0];
  const snapshot = useQuery({
    queryKey: [
      "safe-allowances",
      safe?.chainId,
      safe?.safeAddress,
      module?.address,
    ],
    queryFn: () =>
      readAllowanceSnapshot(safe!.chainId, safe!.safeAddress, module!.address),
    enabled: !!safe && !!module,
    refetchInterval: 30000,
    retry: 1,
  });
  const [editing, setEditing] = useState(false);
  const [revoking, setRevoking] = useState<OnchainAllowance | null>(null);
  const [delegate, setDelegate] = useState("");
  const [token, setToken] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [resetMinutes, setResetMinutes] = useState(0);
  const [acknowledgedFee, setAcknowledgedFee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<string | null>(null);
  const [requestId, setRequestId] = useState("");
  const [legacyFeeMethod, setFeeMethod] = useState(
    RELAY_FEATURE_ENABLED ? "managed" : "wallet",
  );
  const circle = !!safe && supportsCircleFees(safe.chainId);
  const feeMethod = circle ? "circle" : legacyFeeMethod;
  const [feeToken, setFeeToken] = useState("USDC");
  const feeQuote = useConvexQuery(
    api.spendingPolicyData.fee,
    sessionToken && safe && editing && feeMethod === "managed"
      ? { safeId: safe._id, sessionToken, token: feeToken }
      : "skip",
  );
  const feeReviewKey =
    feeMethod === "managed"
      ? feeQuote?.fee
        ? feeIdentity(feeQuote.fee)
        : null
      : feeMethod;
  const acknowledged =
    feeReviewKey !== null && acknowledgedFee === feeReviewKey;
  const setAcknowledged = (value: boolean) =>
    setAcknowledgedFee(value ? feeReviewKey : null);
  const tokens = getTokensForChain(safe?.chainId ?? 0);
  const canManage = isAdmin && !snapshot.isError;
  const assignedAccounts =
    safes?.filter(
      (s) =>
        s.chainId === safe?.chainId &&
        s.isActive !== false &&
        !!s.assignedUserId &&
        members?.some(
          (m) =>
            !!m &&
            m.userId === s.assignedUserId &&
            m.status === "active" &&
            ["admin", "approver", "initiator"].includes(m.role),
        ),
    ) ?? [];
  const name = (wallet: string) => {
    const account = safes?.find(
      (s) => s.safeAddress.toLowerCase() === wallet.toLowerCase(),
    );
    const member = members?.find(
      (m) =>
        m?.userId === account?.assignedUserId ||
        m?.walletAddress.toLowerCase() === wallet.toLowerCase(),
    );
    return member?.name || account?.name || shortAddress(wallet);
  };
  const formatAmount = (row: OnchainAllowance, value: bigint) => {
    const config = Object.values(tokens).find(
      (t) => t.address.toLowerCase() === row.token.toLowerCase(),
    );
    return config
      ? `${formatMoney(formatUnits(value, config.decimals), config.symbol, true)} ${config.symbol}`
      : `${value} base units (${shortAddress(row.token)})`;
  };
  const submit = async () => {
    if (!safe || !module || !address || !acknowledged || busy || !canManage)
      return;
    setBusy(true);
    setError("");
    try {
      if (!sessionToken)
        throw new Error("Sign in before requesting a policy change");
      if (feeMethod === "managed" && !feeQuote?.fee)
        throw new Error("Review an available execution fee");
      const id = await createPolicy({
        safeId: safe._id,
        sessionToken,
        requestId,
        kind: revoking ? "revoke" : "grant",
        module: module.address,
        delegate: revoking?.delegate ?? delegate,
        ...(revoking
          ? { tokenAddress: revoking.token }
          : { token, amount, resetMinutes }),
        ...(feeMethod === "managed" && feeQuote?.fee
          ? { feeToken, reviewedFee: feeIdentity(feeQuote.fee) }
          : {}),
      });
      setProposal(id);
      setEditing(false);
      setRevoking(null);
      await snapshot.refetch();
    } catch (e) {
      setError(userErrorMessage(e, "Could not propose the policy change"));
    } finally {
      setBusy(false);
    }
  };
  const openGrant = () => {
    setRequestId(crypto.randomUUID());
    setEditing(true);
    setRevoking(null);
    setError("");
    setAcknowledged(false);
    setDelegate("");
    setAmount("");
    setToken(Object.keys(tokens)[0] ?? "USDC");
    setResetMinutes(0);
  };
  return (
    <section className="finance-panel overflow-hidden">
      <div className="border-b border-white/10 p-5">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <ShieldCheck className="h-4 w-4 text-accent-400" />
          Delegated spending
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Give a team member a spending allowance. They can pay within that
          limit without collecting account-owner approvals for each payment.
        </p>
      </div>
      <div className="space-y-5 p-5">
        {!safes ? (
          <p className="text-sm text-slate-400">Loading funding accounts…</p>
        ) : !safe ? (
          <p className="text-sm text-slate-400">
            Link a funding account in Settings to manage delegated spending.
          </p>
        ) : (
          <>
            <div className="space-y-4">
              <label>
                <span className="finance-label">Funding account</span>
                <select
                  className="finance-field"
                  value={safe._id}
                  onChange={(e) => {
                    setSafeId(e.target.value);
                    setModuleAddress("");
                  }}
                >
                  {safes.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name || `${getChainName(s.chainId)} account`}
                      {s.name ? ` · ${getChainName(s.chainId)}` : ""} ·{" "}
                      {chainEnvironment(s.chainId) === "test"
                        ? "Test"
                        : chainEnvironment(s.chainId) === "production"
                          ? "Business"
                          : "Unclassified"}
                      {s.isActive === false ? " · Archived" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {!!module && (
                <details className="text-sm text-slate-400">
                  <summary className="cursor-pointer">
                    Advanced policy settings
                  </summary>
                  <label className="mt-3 block">
                    <span className="finance-label">Allowance module</span>
                    <select
                      className="finance-field"
                      value={module.address}
                      aria-label="Allowance module"
                      onChange={(e) => setModuleAddress(e.target.value)}
                    >
                      {deployments.map((d) => (
                        <option key={d.address} value={d.address}>
                          Version {d.version}
                          {d.legacy
                            ? " · Legacy — revoke only"
                            : " · Current"}{" "}
                          · {shortAddress(d.address)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-2 text-xs">
                    Each version has separate allowances. Review all versions
                    when removing spending access.
                  </p>
                  {snapshot.data && (
                    <p className="mt-2 text-xs">
                      Verified at block {snapshot.data.blockNumber.toString()}
                    </p>
                  )}
                </details>
              )}
            </div>
            {safe.isActive === false && (
              <p className="text-sm text-[var(--ws-warning)]">
                This account is archived in Disburse. Existing allowances can
                still authorize transfers. Review and revoke spending access
                here; new grants are disabled.
              </p>
            )}
            {module?.legacy && (
              <p role="alert" className="text-sm leading-6 text-amber-300">
                This older spending module has a known replay vulnerability. New
                grants and payments are disabled in Disburse. Account owners
                should revoke existing grants and recreate reviewed limits on
                the current version.
              </p>
            )}
            {module &&
              !module.legacy &&
              snapshot.data &&
              !supportsCurrentAllowance(snapshot.data.safeVersion) && (
                <p role="alert" className="text-sm text-amber-500">
                  This account version cannot create new spending grants in
                  Disburse. Supported accounts use Safe 1.3.0 or 1.4.1.
                </p>
              )}
            {!module ? (
              <p className="text-sm text-slate-400">
                No supported allowance deployment is configured for this
                network. Manage its policies in Safe.
              </p>
            ) : snapshot.isPending ? (
              <p className="text-sm text-slate-400">
                Reading allowances from the network…
              </p>
            ) : snapshot.isError ? (
              <p role="alert" className="text-sm text-red-400">
                Could not verify current allowances:{" "}
                {userErrorMessage(
                  snapshot.error,
                  "The account could not be checked. Try again shortly.",
                )}
              </p>
            ) : (
              snapshot.data && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-300">
                      {snapshot.data.moduleEnabled
                        ? "Delegated spending is active"
                        : "Delegated spending is not active"}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={snapshot.isFetching}
                        onClick={() => void snapshot.refetch()}
                      >
                        Refresh
                      </Button>
                      {canManage &&
                        safe.isActive !== false &&
                        !module.legacy &&
                        supportsCurrentAllowance(snapshot.data.safeVersion) && (
                          <Button size="sm" onClick={openGrant}>
                            Set allowance
                          </Button>
                        )}
                    </div>
                  </div>
                  {snapshot.data.allowances.length ? (
                    <div className="relative overflow-x-auto">
                      <table className="finance-table">
                        <thead>
                          <tr>
                            <th>Team member</th>
                            <th>Allowance</th>
                            <th>Available</th>
                            <th>Reset interval</th>
                            <th>
                              <span className="sr-only">Manage</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {snapshot.data.allowances.map((row) => (
                            <tr key={`${row.delegate}-${row.token}`}>
                              <td>
                                <span title={row.delegate}>
                                  {name(row.delegate)}
                                </span>
                                <span className="mt-1 block text-xs text-slate-500">
                                  {snapshot.data!.moduleEnabled
                                    ? "Active"
                                    : "Suspended — module disabled"}
                                </span>
                              </td>
                              <td className="tabular-nums">
                                {formatAmount(row, row.amount)}
                              </td>
                              <td className="tabular-nums">
                                {formatAmount(
                                  row,
                                  snapshot.data!.moduleEnabled &&
                                    row.amount > row.spent
                                    ? row.amount - row.spent
                                    : 0n,
                                )}
                              </td>
                              <td>
                                {ALLOWANCE_PERIODS.find(
                                  (p) => p.minutes === row.resetMinutes,
                                )?.label ?? `Every ${row.resetMinutes} minutes`}
                              </td>
                              <td>
                                {canManage && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setRequestId(crypto.randomUUID());
                                      setRevoking(row);
                                      setEditing(true);
                                      setAcknowledged(false);
                                      setError("");
                                    }}
                                  >
                                    Revoke
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="rounded-lg bg-navy-900 p-4 text-sm text-slate-400">
                      No allowances recorded in this module.
                    </p>
                  )}
                  {!canManage && (
                    <p className="text-xs text-slate-400">
                      An organization admin can request a change. Account
                      approvers authorize it before it takes effect.
                    </p>
                  )}
                </>
              )
            )}
            <a
              className="inline-flex items-center gap-2 text-sm text-accent-400"
              href={getSafeAppUrl(safe.chainId, safe.safeAddress)}
              target="_blank"
              rel="noreferrer"
            >
              Advanced account details in Safe
              <ExternalLink size={14} />
            </a>
          </>
        )}
        {safe && module && (
          <PolicyApprovalQueue
            safeId={safe._id}
            memberName={name}
            onExecuted={() => {
              void snapshot.refetch();
            }}
          />
        )}
        {proposal && (
          <div
            role="status"
            className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-4 text-sm text-slate-300"
          >
            <p>
              Policy change proposed. It takes effect only after the required
              account approvals and execution. Review it in Policy approvals
              above.
            </p>
          </div>
        )}
        <section className="rounded-lg border border-[var(--ws-border)] bg-[var(--ws-subtle)] p-4 text-sm" aria-label="Delegated spending limits">
          <h3 className="font-semibold">A delegate can pay any address within their allowance</h3>
          <p className="mt-2 text-[var(--ws-muted)]">
            Disburse recipient lists, per-payment limits and app roles do not
            restrict transfers made outside Disburse. Use owner approvals for
            each payment if your team needs those checks every time.
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer font-medium">Revoking access and checking permissions</summary>
            <p className="mt-2 text-[var(--ws-muted)]">
              Removing a team member does not revoke their allowance. Revoke
              their grants and review every installed module and version in the
              account when offboarding them. Account owners retain full control.
            </p>
            <p className="mt-2 text-[var(--ws-muted)]">
              Inside Disburse, an allowance must cover every recipient payment
              and the reviewed fee before a batch can proceed.
            </p>
          </details>
        </section>
      </div>
      {editing && safe && module && (
        <Dialog
          title={revoking ? "Revoke allowance" : "Set delegated allowance"}
          onClose={() => {
            if (!busy) setEditing(false);
          }}
        >
          <div className="space-y-5 p-6">
            <p className="text-sm text-slate-400">
              {getChainName(safe.chainId)} · {shortAddress(safe.safeAddress)} ·
              module {module.version}
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            {revoking ? (
              <p className="text-sm text-slate-300">
                Revoke {name(revoking.delegate)}’s allowance of{" "}
                {formatAmount(revoking, revoking.amount)}. The delegate can
                still spend until this transaction executes. Other currencies
                and modules are unaffected.
              </p>
            ) : (
              <>
                <label className="block">
                  <span className="finance-label">
                    {circle ? "Assigned payment account" : "Team member"}
                  </span>
                  <select
                    className="finance-field"
                    value={delegate}
                    onChange={(e) => setDelegate(e.target.value)}
                  >
                    <option value="">
                      {circle ? "Choose a member’s account" : "Choose a member"}
                    </option>
                    {circle
                      ? assignedAccounts.map((s) => (
                          <option key={s._id} value={s.safeAddress}>
                            {name(s.safeAddress)} ·{" "}
                            {s.name ?? "Payment account"}
                          </option>
                        ))
                      : members
                          ?.filter(
                            (m) =>
                              m &&
                              m.status === "active" &&
                              ["admin", "approver", "initiator"].includes(
                                m.role,
                              ),
                          )
                          .map(
                            (m) =>
                              m && (
                                <option
                                  key={m.membershipId}
                                  value={m.walletAddress}
                                >
                                  {m.name || shortAddress(m.walletAddress)} ·{" "}
                                  {m.role}
                                </option>
                              ),
                          )}
                  </select>
                </label>
                {circle && !assignedAccounts.length && (
                  <p className="text-sm text-[var(--ws-muted)]">
                    Create an assigned payment account for the member in
                    Settings → Funding accounts first. Its own USDC balance pays
                    execution costs; this allowance controls the separate
                    company funds it can send.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <label>
                    <span className="finance-label">Currency</span>
                    <select
                      className="finance-field"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    >
                      {Object.keys(tokens).map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="finance-label">Allowance</span>
                    <input
                      className="finance-field"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="1,000.00"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="finance-label">Reset interval</span>
                  <select
                    className="finance-field"
                    value={resetMinutes}
                    onChange={(e) => setResetMinutes(Number(e.target.value))}
                  >
                    {ALLOWANCE_PERIODS.map((p) => (
                      <option key={p.minutes} value={p.minutes}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs leading-5 text-slate-400">
                  Fixed intervals start from the module’s reset anchor, not
                  calendar months. Updating an allowance preserves spending
                  already used. One-time allowances have no expiry and remain
                  until spent or revoked.{" "}
                  {snapshot.data?.moduleEnabled
                    ? ""
                    : "This proposal also enables the allowance module."}
                </p>
              </>
            )}
            <div className="space-y-3 rounded-lg border border-[var(--ws-border)] p-4">
              {circle ? (
                <p className="text-sm text-[var(--ws-muted)]">
                  The company account pays the execution fee in USDC. Review the
                  exact limit after the account approves this policy.
                </p>
              ) : (
                <>
                  <label className="block">
                    <span className="finance-label">Execution fee</span>
                    <select
                      className="finance-field"
                      value={feeMethod}
                      onChange={(e) => {
                        setFeeMethod(e.target.value);
                        setAcknowledged(false);
                      }}
                    >
                      <option value="managed">Pay from this account</option>
                      <option value="wallet">
                        Pay network fees from my signing wallet
                      </option>
                    </select>
                  </label>
                  {feeMethod === "managed" ? (
                    <>
                      <label className="block">
                        <span className="finance-label">Fee currency</span>
                        <select
                          className="finance-field"
                          value={feeToken}
                          onChange={(e) => {
                            setFeeToken(e.target.value);
                            setAcknowledged(false);
                          }}
                        >
                          {["USDC", "USDT"]
                            .filter((t) => tokens[t])
                            .map((t) => (
                              <option key={t}>{t}</option>
                            ))}
                        </select>
                      </label>
                      {feeQuote?.fee ? (
                        <p className="text-sm">
                          {formatMoney(
                            feeQuote.fee.amount,
                            feeQuote.fee.token,
                            true,
                          )}{" "}
                          {feeQuote.fee.token} from{" "}
                          {safe.name ?? "this account"} when the policy is
                          applied. This fee is included in the account approval.
                        </p>
                      ) : (
                        <p
                          role={feeQuote?.error ? "alert" : "status"}
                          className="text-sm text-[var(--ws-muted)]"
                        >
                          {feeQuote?.error ?? "Checking the execution fee…"}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-[var(--ws-muted)]">
                      The signing wallet pays the network fee when an approver
                      applies this policy. Your wallet shows the estimate before
                      sending.
                    </p>
                  )}
                </>
              )}
            </div>
            <label className="flex gap-3 text-sm leading-5 text-slate-300">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-1"
              />
              <span>
                {revoking
                  ? "I understand that revocation requires owner approvals and execution."
                  : "I authorize this payment account to transfer the allowed currency to any address within this allowance, independently of Disburse’s approval rules."}
              </span>
            </label>
            <Button
              className="w-full"
              disabled={
                busy ||
                !acknowledged ||
                (feeMethod === "managed" && !feeQuote?.fee) ||
                (!revoking && (!delegate || !amount))
              }
              onClick={() => void submit()}
            >
              {busy ? "Preparing proposal…" : "Request account approval"}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
