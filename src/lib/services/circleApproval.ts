import { createWalletClient, custom, hashTypedData, type Address } from "viem";
import { getConnectedProvider } from "../walletProvider";
import {
  circleFeeSigningData,
  circleRootSigningData,
  type CircleRequest,
} from "../../../shared/circleRequest";
import { circleOperationSigningData } from "../../../shared/circleExecution";
import {
  nestedSigningData,
  recoverSafeSigner,
  safeMessageTypes,
} from "../../../shared/safeSignatures";

export async function signCircleApproval(
  request: CircleRequest,
  stage: "fee" | "operation",
  path: string[],
  wallet: Address,
) {
  if (
    path[0]?.toLowerCase() !== request.safe.toLowerCase() ||
    request.validUntil * 1000 <= Date.now() + 30_000
  )
    throw new Error(
      "This approval changed or expired. Check the saved fee request first.",
    );
  const client = createWalletClient({
    account: wallet,
    transport: custom(await getConnectedProvider(request.chainId), {
      retryCount: 0,
    }),
  });
  const verifyWallet = async () => {
    const [addresses, chainId] = await Promise.all([
      client.getAddresses(),
      client.getChainId(),
    ]);
    if (
      chainId !== request.chainId ||
      addresses[0]?.toLowerCase() !== wallet.toLowerCase()
    )
      throw new Error(
        "Your wallet or network changed. Reconnect the original wallet before approving.",
      );
  };
  await verifyWallet();
  const rootData = circleRootSigningData(request, stage);
  const domain = {
    chainId: request.chainId,
    verifyingContract: path[path.length - 1] as Address,
  };
  const signature =
    path.length > 1
      ? await client.signTypedData({
          domain,
          types: safeMessageTypes,
          primaryType: "SafeMessage",
          message: {
            message: nestedSigningData(request.chainId, path, rootData).message,
          },
        })
      : stage === "fee"
        ? await client.signTypedData({
            domain,
            types: safeMessageTypes,
            primaryType: "SafeMessage",
            message: { message: hashTypedData(circleFeeSigningData(request)) },
          })
        : await client.signTypedData(
            circleOperationSigningData(
              request.chainId,
              request.operation,
              request.validAfter,
              request.validUntil,
            ),
          );
  await verifyWallet();
  if (
    request.validUntil * 1000 <= Date.now() ||
    (await recoverSafeSigner(
      nestedSigningData(request.chainId, path, rootData).hash,
      signature,
    )) !== wallet.toLowerCase()
  )
    throw new Error(
      "The wallet approval expired or belongs to another signer. Review the saved request again.",
    );
  return signature;
}
