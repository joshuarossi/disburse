import { getMultiSendCallOnlyDeployments } from "@safe-global/safe-deployments";
import {
  concat,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { safeAccountDeployment } from "./companyAccountSetup";
import { circleConfiguration } from "./circleExecution";

/** Deploy and assign only the explicitly reviewed USDC balance. A member-owned
 * account does not make that member an owner of the funding company account. */
export function fundedAccountSetup(setup: {
  chainId: number;
  parentAddress: string;
  memberAddress?: string;
  address: string;
  salt: string;
  initialFunding?: string;
}) {
  const deployment = safeAccountDeployment(
    setup.chainId,
    [(setup.memberAddress ?? setup.parentAddress) as Address],
    1,
    setup.salt as Hex,
  );
  if (setup.initialFunding === undefined || setup.initialFunding === "0")
    return { ...deployment, operation: 0 as const };
  if (
    !/^\d{1,9}$/.test(setup.initialFunding) ||
    BigInt(setup.initialFunding) > 100_000_000n
  )
    throw new Error("The initial member balance must be at most 100 USDC.");
  const batch = getMultiSendCallOnlyDeployments({
    version: "1.4.1",
    network: String(setup.chainId),
  });
  const target = batch?.networkAddresses[String(setup.chainId)];
  const address = Array.isArray(target) ? target[0] : target;
  if (!address)
    throw new Error("Funded account setup is not available on this network.");
  const calls = [
    deployment,
    {
      to: circleConfiguration(setup.chainId).token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [setup.address as Address, BigInt(setup.initialFunding)],
      }),
    },
  ];
  return {
    to: address as Address,
    data: encodeFunctionData({
      abi: parseAbi(["function multiSend(bytes transactions)"]),
      functionName: "multiSend",
      args: [
        concat(
          calls.map((c) =>
            concat([
              "0x00",
              c.to,
              toHex(0, { size: 32 }),
              toHex((c.data.length - 2) / 2, { size: 32 }),
              c.data,
            ]),
          ),
        ),
      ],
    }),
    value: "0",
    operation: 1 as const,
    code: deployment.code,
  };
}
