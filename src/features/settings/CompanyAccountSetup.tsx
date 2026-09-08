import { amountToBaseUnits } from "../../../shared/validation";
import { formatUnits } from "viem";
import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { circleConfiguration } from "../../../shared/circleExecution";
import { CustomerPaidExecution } from "@/features/payments/CustomerPaidExecution";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { userErrorMessage } from "@/lib/userErrors";
import { getChainName } from "@/lib/chains";
import type { useSettingsController } from "./useSettingsController";

export function CompanyAccountSetup({
  controller,
}: {
  controller: ReturnType<typeof useSettingsController>;
}) {
  const { orgId, safes, isAdmin, currentUserRole, members } = controller,
    sessionToken = useSessionToken();
  const current = useQuery(
    api.accountSetups.current,
    orgId && sessionToken
      ? { orgId: orgId as Id<"orgs">, sessionToken }
      : "skip",
  );
  const [id, setId] = useState<Id<"accountSetups">>(),
    [show, setShow] = useState(false),
    [name, setName] = useState(""),
    [parent, setParent] = useState(""),
    [member, setMember] = useState(""),
    [initialBalance, setInitialBalance] = useState("5"),
    [memberControl, setMemberControl] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    requestId = useRef(crypto.randomUUID());
  const saved = useQuery(
      api.accountSetups.get,
      id && sessionToken ? { accountSetupId: id, sessionToken } : "skip",
    ),
    setup = id ? saved : current;
  const execution = useQuery(
    api.circlePayments.get,
    setup && sessionToken
      ? { accountSetupId: setup._id, sessionToken }
      : "skip",
  );
  const create = useAction(api.accountSetups.create),
    recheck = useAction(api.accountSetups.recheck),
    discard = useMutation(api.accountSetups.discard);
  const accounts =
    safes?.filter((s) => {
      try {
        circleConfiguration(s.chainId);
        return s.isActive !== false;
      } catch {
        return false;
      }
    }) ?? [];
  const parentId = parent || accounts[0]?._id;
  const parentName = (safeId: string) => {
    const safe = safes?.find((s) => s._id === safeId);
    return (
      safe?.name ??
      (safe
        ? `${getChainName(safe.chainId)} account`
        : "Parent company account")
    );
  };
  const run = async (work: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        userErrorMessage(
          e,
          "Could not complete account setup. Check the saved request before trying again.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const open = () => {
    setId(current?._id);
    setError("");
    requestId.current = crypto.randomUUID();
    setShow(true);
  };
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {current ? (
          <button className="workspace-button" onClick={open}>
            Review account setup
          </button>
        ) : (
          isAdmin &&
          !!accounts.length && (
            <button
              className="workspace-button workspace-button-primary"
              disabled={current === undefined}
              onClick={open}
            >
              Create company account
            </button>
          )
        )}
        {current && (
          <p className="workspace-description">
            {current.name} is waiting for setup.
          </p>
        )}
      </div>
      {show && (
        <Dialog
          title={
            setup?.status === "complete"
              ? `${setup.name} is ready`
              : "Create company account"
          }
          onClose={() => {
            if (!busy) setShow(false);
          }}
        >
          <div className="p-6 space-y-5">
            {error && <Notice>{error}</Notice>}
            {setup?.status === "complete" ? (
              <>
                <Notice tone="info">
                  Your new account is connected.{" "}
                  {setup.memberUserId
                    ? (members?.find((m) => m?.userId === setup.memberUserId)
                        ?.name ?? "The assigned member")
                    : parentName(setup.parentSafeId)}{" "}
                  controls its approvals.
                </Notice>
                <p className="workspace-description">
                  {setup.initialFunding
                    ? `${formatUnits(BigInt(setup.initialFunding), 6)} USDC was assigned to this account. Grant its spending limit in Team & approvals to enable delegated company payments.`
                    : "The account starts empty. You can now select it for funding and payments."}
                </p>
                <button
                  className="workspace-button workspace-button-primary"
                  onClick={() => setShow(false)}
                >
                  Done
                </button>
              </>
            ) : setup ? (
              <>
                <dl className="workspace-detail-grid">
                  <div>
                    <dt>New account</dt>
                    <dd>{setup.name}</dd>
                  </div>
                  <div>
                    <dt>Setup and funding paid by</dt>
                    <dd>{parentName(setup.parentSafeId)}</dd>
                  </div>
                  <div>
                    <dt>Account owner</dt>
                    <dd>
                      {setup.memberUserId
                        ? (members?.find(
                            (m) => m?.userId === setup.memberUserId,
                          )?.name ?? setup.memberAddress)
                        : parentName(setup.parentSafeId)}
                    </dd>
                  </div>
                  {setup.initialFunding && (
                    <div>
                      <dt>Assigned balance</dt>
                      <dd>
                        {formatUnits(BigInt(setup.initialFunding), 6)} USDC,
                        plus the setup fee
                      </dd>
                    </div>
                  )}
                </dl>
                <p className="workspace-description">
                  {setup.memberUserId
                    ? "The funding account’s owners approve this setup and balance assignment. The selected member controls the new account, including withdrawals and ownership changes. They do not become an owner of the funding account. Company payment limits are granted separately."
                    : "The parent account’s current owners approve this setup and future payments from the new account. The new account starts empty."}
                </p>
                <CustomerPaidExecution
                  source={{ accountSetupId: setup._id }}
                  ready={
                    setup.status === "prepared" &&
                    execution?.stage !== "confirmed"
                  }
                  blocked={
                    busy ||
                    !["admin", "approver"].includes(currentUserRole ?? "")
                  }
                  memberName={(wallet) =>
                    members?.find(
                      (m) =>
                        m?.walletAddress.toLowerCase() === wallet.toLowerCase(),
                    )?.name ?? wallet
                  }
                  onBusyChange={setBusy}
                  compact
                />
                {isAdmin && (
                  <div className="flex flex-wrap gap-3">
                    {execution?.stage === "confirmed" && (
                      <button
                        className="workspace-button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            recheck({
                              accountSetupId: setup._id,
                              sessionToken: sessionToken!,
                            }),
                          )
                        }
                      >
                        Connect completed account
                      </button>
                    )}
                    {execution !== undefined &&
                      !execution?.open &&
                      execution?.stage !== "confirmed" && (
                        <button
                          className="workspace-action-link"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await discard({
                                accountSetupId: setup._id,
                                sessionToken: sessionToken!,
                              });
                              setId(undefined);
                              setShow(false);
                            })
                          }
                        >
                          Discard unsubmitted setup
                        </button>
                      )}
                  </div>
                )}
              </>
            ) : current === undefined || (id && saved === undefined) ? (
              <p role="status" className="workspace-description">
                Loading saved setup…
              </p>
            ) : (
              <>
                <p className="workspace-description">
                  Create a shared company account, or assign a small payment
                  account to a team member. The funding account pays setup costs
                  in USDC.
                </p>
                <label className="workspace-field">
                  <span>Account name</span>
                  <input
                    value={name}
                    maxLength={80}
                    placeholder="Payroll"
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className="workspace-field">
                  <span>Parent company account</span>
                  <select
                    value={parentId}
                    onChange={(e) => setParent(e.target.value)}
                    disabled={busy}
                  >
                    {accounts.map((s) => (
                      <option key={s._id} value={s._id}>
                        {parentName(s._id)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="workspace-field">
                  <span>Account control</span>
                  <select
                    aria-label="Account control"
                    value={member}
                    disabled={busy}
                    onChange={(e) => {
                      setMember(e.target.value);
                      setMemberControl(false);
                    }}
                  >
                    <option value="">Company owners — shared account</option>
                    {members
                      ?.filter(
                        (m) =>
                          m?.status === "active" &&
                          ["admin", "approver", "initiator"].includes(m.role),
                      )
                      .map(
                        (m) =>
                          m && (
                            <option key={m.userId} value={m.userId}>
                              {m.name ?? m.walletAddress} — assigned payment
                              account
                            </option>
                          ),
                      )}
                  </select>
                </label>
                {member && (
                  <>
                    <label className="workspace-field">
                      <span>Initial execution balance (USDC)</span>
                      <input
                        inputMode="decimal"
                        value={initialBalance}
                        onChange={(e) => {
                          setInitialBalance(e.target.value);
                          setMemberControl(false);
                        }}
                        disabled={busy}
                      />
                    </label>
                    <p className="workspace-description">
                      Assign 3–100 USDC for the member to pay execution fees.
                      This is a balance transfer, separate from the setup fee.
                      Recipient funds stay in your company account under the
                      spending limit you grant next.
                    </p>
                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={memberControl}
                        onChange={(e) => setMemberControl(e.target.checked)}
                        disabled={busy}
                      />
                      <span>
                        I understand this member controls the assigned account’s
                        balance and ownership. Returning unused funds requires
                        their approval.
                      </span>
                    </label>
                  </>
                )}
                <button
                  className="workspace-button workspace-button-primary"
                  disabled={
                    busy ||
                    !name.trim() ||
                    (!!member && !memberControl) ||
                    !parentId ||
                    !sessionToken ||
                    !isAdmin
                  }
                  onClick={() =>
                    void run(async () => {
                      const result = await create({
                        orgId: orgId as Id<"orgs">,
                        sessionToken: sessionToken!,
                        parentSafeId: parentId as Id<"safes">,
                        name: name.trim(),
                        requestId: requestId.current,
                        ...(member
                          ? {
                              memberUserId: member as Id<"users">,
                              initialFunding: String(
                                amountToBaseUnits(initialBalance, "USDC"),
                              ),
                              memberControlAcknowledged: memberControl,
                            }
                          : {}),
                      });
                      setId(result);
                    })
                  }
                >
                  {busy ? "Preparing account…" : "Review account setup"}
                </button>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
