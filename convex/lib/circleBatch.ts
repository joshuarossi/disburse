import { getMultiSendCallOnlyDeployments } from "@safe-global/safe-deployments";
import {
  decodeFunctionData,
  encodeFunctionData,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { getChainClient } from "./safeVerification";

const abi = parseAbi(["function multiSend(bytes transactions)"]);

/** The only delegatecall this execution service accepts is the published
 * CALL-only batch contract. Every packed operation must spend zero native coin. */
export async function assertCircleBatch(
  chainId: number,
  transaction: { to: string; data: string; operation?: 0 | 1 },
) {
  if (transaction.operation !== 1) return;
  const deployment = getMultiSendCallOnlyDeployments({
    version: "1.4.1",
    network: String(chainId),
  });
  const network = deployment?.networkAddresses[String(chainId)];
  const allowed = network ? (Array.isArray(network) ? network : [network]) : [];
  const contract =
    deployment &&
    Object.values(deployment.deployments).find(
      (d) => d?.address.toLowerCase() === transaction.to.toLowerCase(),
    );
  if (
    !contract ||
    !allowed.some((a) => a.toLowerCase() === transaction.to.toLowerCase())
  )
    throw new Error("This batch contract is not supported.");
  const decoded = decodeFunctionData({ abi, data: transaction.data as Hex });
  if (
    encodeFunctionData({
      abi,
      functionName: decoded.functionName,
      args: decoded.args,
    }).toLowerCase() !== transaction.data.toLowerCase()
  )
    throw new Error("The batch instructions are not canonical.");
  const packed = decoded.args[0].slice(2);
  let offset = 0,
    count = 0;
  while (offset < packed.length) {
    if (
      packed.length - offset < 170 ||
      packed.slice(offset, offset + 2) !== "00" ||
      BigInt(`0x${packed.slice(offset + 42, offset + 106)}`) !== 0n
    )
      throw new Error("A batch may only contain calls paid in stablecoins.");
    const length = BigInt(`0x${packed.slice(offset + 106, offset + 170)}`);
    if (length > 100_000n)
      throw new Error("The batch instruction is too large.");
    offset += 170 + Number(length) * 2;
    count++;
  }
  if (offset !== packed.length || count < 1 || count > 201)
    throw new Error("The batch instructions are incomplete.");
  const code = await getChainClient(chainId).getCode({
    address: transaction.to as Address,
  });
  if (!code || keccak256(code) !== contract.codeHash)
    throw new Error(
      "Batch contract code does not match its supported deployment.",
    );
}
