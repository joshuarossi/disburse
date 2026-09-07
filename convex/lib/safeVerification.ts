import { createPublicClient, fallback, http, parseAbi } from "viem";
import {
  mainnet,
  polygon,
  base,
  arbitrum,
  sepolia,
  baseSepolia,
} from "viem/chains";
import { assertValidAddress } from "./validation";
import { assertSafeIdentity } from "./safeIdentity";
import { approvalPaths, readAccountAuthority } from './accountAuthority';

const chains = [mainnet, polygon, base, arbitrum, sepolia, baseSepolia];
const abi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);

export function getChainClient(chainId: number, options: { historical?: boolean } = {}) {
  const chain = chains.find((chain) => chain.id === chainId);
  if (!chain) throw new Error("Unsupported funding account network");
  const configured = (options.historical ? process.env[`ARCHIVE_RPC_URL_${chainId}`] : undefined) || process.env[`RPC_URL_${chainId}`];
  const primary = http(configured || chain.rpcUrls.default.http[0], {
    timeout: 15_000,
    retryCount: configured ? 1 : 0,
    // Historical providers vary in JSON-RPC batch support. Period checks use
    // bounded concurrent reads and do not depend on their batch response order.
    batch: !options.historical,
    onFetchRequest: options.historical ? async () => { await new Promise(resolve => setTimeout(resolve, 125)); } : undefined,
  });
  return createPublicClient({
    chain,
    // Explicit customer endpoints stay authoritative. Base's public default
    // rate-limits normal identity checks, so local/default operation has a second reader.
    transport:
      !configured && chainId === base.id
        ? fallback(
            [
              primary,
              http("https://base-rpc.publicnode.com", {
                timeout: 15_000,
                retryCount: 0,
                batch: true,
              }),
            ],
            { retryCount: 1 },
          )
        : primary,
  });
}

export async function verifySafeOwnership(
  safeAddress: string,
  chainId: number,
  walletAddress: string,
) {
  assertValidAddress(safeAddress, "Safe address");
  const client = getChainClient(chainId);
  const address = safeAddress as `0x${string}`;
  const blockNumber = await client.getBlockNumber();
  await assertSafeIdentity(client, address, chainId, blockNumber);
  const [owners, threshold] = await Promise.all([
    client.readContract({
      address,
      abi,
      functionName: "getOwners",
      blockNumber,
    }),
    client.readContract({
      address,
      abi,
      functionName: "getThreshold",
      blockNumber,
    }),
  ]);
  if (threshold < 1n || threshold > BigInt(owners.length))
    throw new Error("Invalid Safe signing threshold");
  if (
    !owners.some((owner) => owner.toLowerCase() === walletAddress.toLowerCase())
  )
    if (!approvalPaths(await readAccountAuthority(chainId, safeAddress, blockNumber), walletAddress).length)
      throw new Error("You must be a current approver of this account or an owning account to link it");
  return {
    owners: owners.map((owner) => owner.toLowerCase()),
    threshold: Number(threshold),
  };
}
