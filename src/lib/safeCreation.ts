import Safe from "@safe-global/protocol-kit";
import { getAddress } from "viem";
import { getConnectedProvider } from "./walletProvider";

/**
 * Deploy a new Safe multisig.  Returns { predictedAddress, deployTx } where
 * deployTx is a plain { to, data, value } the caller can send via wagmi's
 * useSendTransaction.
 *
 * The Safe address is deterministic (CREATE2) so it is known before the
 * deploy tx confirms.  The caller is responsible for sending the transaction.
 */
export async function createSafe(
  owners: string[],
  threshold: number,
  saltNonce: string = "0",
  chainId?: number,
): Promise<{
  predictedAddress: string;
  deployTx: { to: string; data: string; value: bigint };
}> {
  const provider = await getConnectedProvider(chainId);
  const checksummedOwners = owners.map((o) => getAddress(o));

  const protocolKit = await Safe.init({
    provider,
    predictedSafe: {
      safeAccountConfig: {
        owners: checksummedOwners,
        threshold,
      },
      safeDeploymentConfig: {
        saltNonce,
      },
    },
  });

  const predictedAddress = await protocolKit.getAddress();
  const deployTx = await protocolKit.createSafeDeploymentTransaction();

  return {
    predictedAddress,
    deployTx: {
      to: deployTx.to,
      data: deployTx.data,
      value: BigInt(deployTx.value || "0"),
    },
  };
}
