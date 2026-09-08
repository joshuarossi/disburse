import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { formatUnits } from "viem";
import { api } from "../../../convex/_generated/api";
import { useSessionToken } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/workspace/WorkspacePrimitives";
import { walletErrorMessage } from "@/lib/walletErrors";
import { readServiceRecord } from "../../../shared/customerServiceRecord";
import { MetaMaskPaidSetup, type SetupProps } from "./MetaMaskPaidSetup";

/** Previously authorized provider requests retain their original recovery path.
 * New setups use the customer's MetaMask fee service. */
export function CustomerPaidSetup(props: SetupProps) {
  const { orgId, chainId, onBusy, onRestore, onComplete } = props,
    sessionToken = useSessionToken();
  const current = useQuery(
    api.customerOperations.current,
    sessionToken ? { orgId, sessionToken } : "skip",
  );
  const conflict = useQuery(
    api.customerOperations.conflict,
    sessionToken ? { orgId, chainId, sessionToken } : "skip",
  );
  const refresh = useAction(api.customerExecution.refresh),
    link = useAction(api.customerExecution.completeSetup);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const lock = useRef(false),
    restored = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (current || conflict) onBusy(true);
  }, [current, conflict, onBusy]);
  useEffect(() => {
    if (!current || restored.current === current._id) return;
    restored.current = current._id;
    try {
      const saved = readServiceRecord(current.record);
      if (saved.account)
        onRestore({
          chainId: current.chainId,
          owners: saved.account.owners,
          threshold: saved.account.threshold,
        });
    } catch {
      setError(
        "The saved setup details could not be read. Keep this request for recovery before starting another.",
      );
    }
  }, [current, onRestore]);
  if (current === undefined || conflict === undefined)
    return (
      <p role="status" className="workspace-description">
        Checking for an earlier setup request…
      </p>
    );
  if (!current && !conflict) return <MetaMaskPaidSetup {...props} />;
  const operationId = current?._id ?? conflict!.operationId;
  const check = async () => {
    if (lock.current || !sessionToken) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await refresh({ operationId, sessionToken });
      if (current && result.state === "confirmed") {
        await link({ operationId, sessionToken });
        onComplete();
        return;
      }
      setNotice(
        result.state === "pending"
          ? "The original request is still awaiting confirmation. Checking again does not submit another transaction."
          : "The earlier provider request is resolved. You can now review a new account setup.",
      );
    } catch (e) {
      setError(
        walletErrorMessage(
          e,
          "Could not verify account setup yet. Your original request is saved. Check again shortly.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section aria-label="Account setup cost" className="space-y-4">
      <Notice tone="info">
        An earlier account setup request is saved for this wallet
        {conflict && !current ? " in another organization" : ""}. Check it
        before starting another.
      </Notice>
      {error && <Notice>{error}</Notice>}
      {notice && <Notice tone="info">{notice}</Notice>}
      {current && (
        <p className="workspace-description">
          {/^(?:0|[1-9]\d{0,77})$/.test(current.fee)
            ? `Approved provider fee: ${formatUnits(BigInt(current.fee), 6)} USDC.`
            : "The saved fee amount needs verification."}{" "}
          Checking status does not charge a fee.
        </p>
      )}
      <Button className="w-full" disabled={busy} onClick={() => void check()}>
        {busy
          ? "Checking setup…"
          : current
            ? "Check setup status"
            : "Check earlier setup"}
      </Button>
    </section>
  );
}
