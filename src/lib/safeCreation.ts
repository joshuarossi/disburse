import Safe from "@safe-global/protocol-kit";
import { getConnectedProvider } from "./walletProvider";
import { customerPaidSafeConfig } from '../../shared/safe4337';

/**
 * Prepare the deterministic Safe address and deployment calldata for the
 * customer-paid setup service. This function never requests a wallet broadcast.
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
  const actualChainId = Number(await provider.request({ method: 'eth_chainId' }));
  if (chainId !== undefined && chainId !== actualChainId) throw new Error('Your wallet changed networks. Select the account network and try again.');

  const protocolKit = await Safe.init({
    provider,
    predictedSafe: {
      safeAccountConfig: customerPaidSafeConfig(actualChainId, owners, threshold),
      safeDeploymentConfig: {
        saltNonce,
        // Keep creation aligned with the implementations verified by the backend.
        // The SDK default is 1.5.0, which our identity checker does not accept.
        safeVersion: '1.4.1',
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
