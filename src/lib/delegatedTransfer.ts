import {
  createWalletClient,
  custom,
  type Address,
  type Hex,
} from "viem";
import { getConnectedProvider } from "./walletProvider";
import { CHAIN_ID_TO_CHAIN, isSupportedChainId } from "./chains";
async function clients(chainId: number) {
  if (!isSupportedChainId(chainId))
    throw new Error("Unsupported payment network.");
  const provider = await getConnectedProvider(chainId);
  const chain = CHAIN_ID_TO_CHAIN[chainId];
  return {
    wallet: createWalletClient({ chain, transport: custom(provider) }),
  };
}
export async function signAllowanceAuthorization(
  chainId: number,
  delegate: string,
  hash: string,
) {
  const { wallet } = await clients(chainId);
  return wallet.signMessage({
    account: delegate as Address,
    message: { raw: hash as Hex },
  });
}
