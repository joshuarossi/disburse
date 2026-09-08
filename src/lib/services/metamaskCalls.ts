import type { Eip1193Provider } from "@safe-global/protocol-kit";
import type { Hex } from "viem";
import {
  customerWalletBatch,
  type WalletCalls,
} from "../../../shared/walletCalls";
import { parseWalletBatchStatus } from "../../../shared/walletSetup";
import { getConnectedProvider } from "../walletProvider";
import { checkSetupWallet, walletSetupNotAccepted } from "./metamaskSetup";
export { walletSetupNotAccepted as walletRequestNotAccepted };
export async function checkCustomerWallet(
  intent: Pick<WalletCalls, "chainId" | "payer">,
) {
  return checkSetupWallet(intent);
}
export async function submitCustomerWalletCalls(
  intent: WalletCalls,
  batchId: Hex,
  provider: Eip1193Provider,
) {
  // Recheck the selected payer immediately before the submitting request.
  try {
    await checkSetupWallet(intent, provider);
  } catch {
    throw Object.assign(
      new Error(
        "Your wallet connection changed before submission. Review the original request again.",
      ),
      { code: 4100 },
    );
  }
  const response = (await provider.request({
    method: "wallet_sendCalls",
    params: [customerWalletBatch(intent, batchId)],
  })) as { id?: string; batchId?: string };
  if (
    (response?.id ?? response?.batchId)?.toLowerCase() !== batchId.toLowerCase()
  )
    throw new Error(
      "The wallet did not confirm the original request. Check its status before continuing.",
    );
}
export async function checkCustomerWalletCalls(chainId: number, batchId: Hex) {
  const provider = await getConnectedProvider(chainId);
  return parseWalletBatchStatus(
    await provider.request({
      method: "wallet_getCallsStatus",
      params: [batchId],
    }),
    chainId,
  );
}
