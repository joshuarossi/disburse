import {
  getProxyFactoryDeployment,
  getSafeL2SingletonDeployment,
} from "@safe-global/safe-deployments";
import {
  encodeFunctionData,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { customerPaidSafeConfig } from "./safe4337";

export const companyFactoryAbi = parseAbi([
  "function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns(address proxy)",
]);
/** A named subaccount inherits the parent account's actual owner quorum. */
export function companyAccountDeployment(
  chainId: number,
  parent: Address,
  salt: Hex,
) {
  return safeAccountDeployment(chainId, [parent], 1, salt);
}

export function safeAccountDeployment(
  chainId: number,
  owners: Address[],
  threshold: number,
  salt: Hex,
) {
  const filter = { network: String(chainId), version: "1.4.1" };
  const factory = getProxyFactoryDeployment(filter),
    singleton = getSafeL2SingletonDeployment(filter);
  if (
    !factory?.released ||
    !singleton?.released ||
    factory.networkAddresses[String(chainId)]?.toLowerCase() !==
      factory.deployments.canonical?.address.toLowerCase() ||
    singleton.networkAddresses[String(chainId)]?.toLowerCase() !==
      singleton.deployments.canonical?.address.toLowerCase()
  )
    throw new Error(
      "Company account creation is not supported on this network.",
    );
  const config = customerPaidSafeConfig(chainId, owners, threshold);
  const initializer = encodeFunctionData({
    abi: parseAbi([
      "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
    ]),
    functionName: "setup",
    args: [
      config.owners,
      BigInt(config.threshold),
      config.to,
      config.data,
      config.fallbackHandler,
      zeroAddress,
      0n,
      zeroAddress,
    ],
  });
  const to = factory.deployments.canonical.address as Address,
    implementation = singleton.deployments.canonical.address as Address;
  return {
    to,
    data: encodeFunctionData({
      abi: companyFactoryAbi,
      functionName: "createProxyWithNonce",
      args: [implementation, initializer, BigInt(salt)],
    }),
    value: "0",
    code: [
      { address: to, hash: factory.deployments.canonical.codeHash },
      {
        address: implementation,
        hash: singleton.deployments.canonical.codeHash,
      },
    ],
  };
}
