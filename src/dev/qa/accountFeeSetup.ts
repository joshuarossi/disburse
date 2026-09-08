/* eslint-disable @typescript-eslint/no-explicit-any -- serve-only browser fixtures */
import { safes, wallet } from "./fixtures";
const key = "qa:account-fee-setup";
export const readAccountFeeSetup = () =>
  JSON.parse(sessionStorage.getItem(key) ?? "null");
export async function accountFeeSetupFixture(name: string, args: any) {
  const scenario = sessionStorage.getItem("qa:scenario") ?? "";
  if (!scenario.startsWith("account-fee-"))
    throw new Error("Visual QA mode is read-only.");
  const saved = readAccountFeeSetup(),
    safe = safes[0],
    hash = `0x${"ab".repeat(32)}`;
  const write = (value: any) =>
    sessionStorage.setItem(key, JSON.stringify(value));
  if (name === "accountFeeSetups:inspect") {
    if (scenario.endsWith("outage"))
      throw new Error("RPC https://rpc.invalid/private unavailable");
    if (scenario.endsWith("custom-handler"))
      throw new Error(
        "This account uses a custom signature handler. Its existing integrations need review before enabling USDC fees.",
      );
    return {
      ready: scenario.endsWith("already-ready") || saved?.stage === "complete",
    };
  }
  if (name === "accountFeeSetups:prepare") {
    write({
      _id: "fee-setup1",
      safeId: safe._id,
      safeAddress: safe.safeAddress,
      chainId: 8453,
      stage: "approval",
      open: true,
      signatures: [],
      attempt: 0,
      batchId: hash,
      updatedAt: 1,
    });
    return "fee-setup1";
  }
  if (name === "accountFeeSetups:approvals")
    return {
      proposal: {
        safeAddress: safe.safeAddress,
        safeTxHash: hash,
        safeTransactionData: {},
      },
      currentNonce: 1,
      names: [],
      paths: [
        {
          path: [safe.safeAddress],
          labels: ["Operations"],
          approved: !!saved.signatures.length,
        },
      ],
      groups: [
        {
          address: safe.safeAddress.toLowerCase(),
          path: [safe.safeAddress],
          owners: [wallet],
          threshold: 1,
          confirmedOwners: saved.signatures.length ? [wallet] : [],
        },
      ],
      ready: !!saved.signatures.length,
      blockedReason: null,
    };
  if (name === "accountFeeSetups:approve") {
    write({
      ...saved,
      signatures: [{ owner: wallet }],
      updatedAt: saved.updatedAt + 1,
    });
    return;
  }
  if (name === "accountFeeSetups:begin") {
    if (scenario.endsWith("claim-failed"))
      throw new Error("Database disconnected before saving");
    write({
      ...saved,
      stage: "requested",
      claimId: args.claimId,
      payer: wallet.toLowerCase(),
      updatedAt: saved.updatedAt + 1,
    });
    if (scenario.endsWith("claim-response-lost"))
      throw new Error("Database reply interrupted");
    return {
      batchId: saved.batchId,
      intent: {
        chainId: 8453,
        payer: wallet,
        calls: [{ to: safe.safeAddress, data: "0x1234" }],
      },
    };
  }
  if (name === "accountFeeSetups:declined") {
    if (
      scenario.endsWith("decline-save-failed") &&
      !sessionStorage.getItem("qa:fee-decline-failed")
    ) {
      sessionStorage.setItem("qa:fee-decline-failed", "true");
      throw new Error("Database reply interrupted");
    }
    write({
      ...saved,
      stage: "approval",
      attempt: saved.attempt + 1,
      batchId: `0x${"bc".repeat(32)}`,
      claimId: undefined,
      updatedAt: saved.updatedAt + 1,
    });
    return;
  }
  if (name === "accountFeeSetups:check") {
    if (scenario.endsWith("success"))
      write({
        ...saved,
        stage: "complete",
        open: false,
        updatedAt: saved.updatedAt + 1,
      });
    return;
  }
  if (name === "accountFeeSetups:discard") {
    sessionStorage.removeItem(key);
    return;
  }
  throw new Error("Unexpected QA account fee operation.");
}
