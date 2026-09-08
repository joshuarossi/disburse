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
                  {parentName(setup.parentSafeId)} controls its approvals.
                </Notice>
                <p className="workspace-description">
                  The account starts empty. You can now select it for funding
                  and payments.
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
                    <dt>Controlled and paid for by</dt>
                    <dd>{parentName(setup.parentSafeId)}</dd>
                  </div>
                </dl>
                <p className="workspace-description">
                  The parent account's current owners approve this setup and
                  future payments from the new account. The new account starts
                  empty. Its funds remain under your team's control.
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
                  Give payroll, operations, or reserves a separate account. Your
                  parent company account pays the setup fee in USDC and keeps
                  control of its approvals.
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
                <button
                  className="workspace-button workspace-button-primary"
                  disabled={
                    busy ||
                    !name.trim() ||
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
