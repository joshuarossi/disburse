import type { Eip1193Provider } from "@safe-global/protocol-kit";
import { toHex, type Hex } from "viem";
import { getConnectedProvider } from "../walletProvider";
import {
  parseWalletBatchStatus,
  walletSetupBatch,
  type WalletSetupIntent,
} from "../../../shared/walletSetup";

export function walletSetupNotAccepted(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  // Duplicate ID (5720), timeouts and unknown errors require original recovery.
  return (
    typeof code === "number" &&
    [4001, 4100, 5700, 5710, 5740, 5750, -32602].includes(code)
  );
}

export async function checkSetupWallet(
  intent: Pick<WalletSetupIntent, 'chainId' | 'payer'>,
  supplied?: Eip1193Provider,
) {
  const provider = supplied ?? (await getConnectedProvider(intent.chainId));
  const [chain, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  if (
    Number(chain) !== intent.chainId ||
    !Array.isArray(accounts) ||
    String(accounts[0]).toLowerCase() !== intent.payer.toLowerCase()
  )
    throw new Error(
      "Your wallet or network changed. Reconnect the wallet that prepared this setup.",
    );
  const capabilities = (await provider.request({
    method: "wallet_getCapabilities",
    params: [intent.payer, [toHex(intent.chainId)]],
  })) as Record<string, { atomic?: { status?: string } }>;
  if (
    !["ready", "supported"].includes(
      capabilities?.[toHex(intent.chainId)]?.atomic?.status ?? "",
    )
  )
    throw new Error(
      "This wallet cannot create and fund the account together. Connect a current MetaMask wallet on Base or Arbitrum.",
    );
  return provider;
}

/** MetaMask quotes and charges its customer directly in its confirmation. No
 * application paymaster URL, provider credential or native-payment fallback.
 * EIP-5792 does not expose fee-token selection to the dapp. The customer must
 * select USDC in MetaMask's Network fee field before confirming. */
export async function submitWalletSetup(
  intent: WalletSetupIntent,
  batchId: Hex,
  supplied?: Eip1193Provider,
) {
  const provider = supplied ?? (await checkSetupWallet(intent));
  const response = (await provider.request({
    method: "wallet_sendCalls",
    params: [walletSetupBatch(intent, batchId)],
  })) as { id?: string; batchId?: string };
  if (
    (response?.id ?? response?.batchId)?.toLowerCase() !== batchId.toLowerCase()
  )
    throw new Error(
      "The wallet did not confirm the original setup request. Check its status before continuing.",
    );
}
export async function checkWalletSetup(
  intent: WalletSetupIntent,
  batchId: Hex,
  supplied?: Eip1193Provider,
) {
  const provider = supplied ?? (await getConnectedProvider(intent.chainId));
  return parseWalletBatchStatus(
    await provider.request({
      method: "wallet_getCallsStatus",
      params: [batchId],
    }),
    intent.chainId,
  );
}
