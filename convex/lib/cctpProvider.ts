import {
  erc20Abi,
  keccak256,
  pad,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  assertCctpRoute,
  cctpAbi,
  cctpConfiguration,
  makeCctpQuote,
  type CctpQuote,
} from "../../shared/cctp";
import { CCTP_CONTRACT_PINS } from "../../shared/cctpDeployments";
import { getChainClient } from "./safeVerification";

const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
export async function verifyCctpContracts(
  chainId: number,
  remoteChainId: number,
) {
  const config = cctpConfiguration(chainId),
    remote = cctpConfiguration(remoteChainId);
  const pins =
    CCTP_CONTRACT_PINS[String(chainId) as keyof typeof CCTP_CONTRACT_PINS];
  if (!pins)
    throw new Error(
      "The transfer provider has not been verified on this network.",
    );
  const client = getChainClient(chainId),
    blockNumber = await client.getBlockNumber();
  if ((await client.getChainId()) !== chainId)
    throw new Error("The transfer network could not be verified.");
  await Promise.all(
    (["messenger", "transmitter", "minter"] as const).map(async (name) => {
      const address = config[name],
        pin = pins[name];
      const code = await client.getCode({ address, blockNumber });
      if (!code || keccak256(code) !== pin.codeHash)
        throw new Error(
          "The transfer provider changed its contracts. New transfers need a provider review.",
        );
      if (pin.implementation !== zeroAddress) {
        const slot = await client.getStorageAt({
          address,
          slot: implementationSlot,
          blockNumber,
        });
        const implementation = `0x${slot?.slice(-40)}` as Address;
        const code = slot
          ? await client.getCode({ address: implementation, blockNumber })
          : undefined;
        if (
          implementation !== pin.implementation ||
          !code ||
          keccak256(code) !== pin.implementationCodeHash
        )
          throw new Error(
            "The transfer provider upgraded its contracts. New transfers need a provider review.",
          );
      }
    }),
  );
  const [transmitter, minter, peer, bodyVersion, domain, version, paused] =
    await Promise.all([
      client.readContract({
        address: config.messenger,
        abi: cctpAbi,
        functionName: "localMessageTransmitter",
        blockNumber,
      }),
      client.readContract({
        address: config.messenger,
        abi: cctpAbi,
        functionName: "localMinter",
        blockNumber,
      }),
      client.readContract({
        address: config.messenger,
        abi: cctpAbi,
        functionName: "remoteTokenMessengers",
        args: [remote.domain],
        blockNumber,
      }),
      client.readContract({
        address: config.messenger,
        abi: cctpAbi,
        functionName: "messageBodyVersion",
        blockNumber,
      }),
      client.readContract({
        address: config.transmitter,
        abi: cctpAbi,
        functionName: "localDomain",
        blockNumber,
      }),
      client.readContract({
        address: config.transmitter,
        abi: cctpAbi,
        functionName: "version",
        blockNumber,
      }),
      client.readContract({
        address: config.transmitter,
        abi: cctpAbi,
        functionName: "paused",
        blockNumber,
      }),
    ]);
  if (
    transmitter.toLowerCase() !== config.transmitter.toLowerCase() ||
    minter.toLowerCase() !== config.minter.toLowerCase() ||
    peer.toLowerCase() !== pad(remote.messenger, { size: 32 }).toLowerCase() ||
    bodyVersion !== 1 ||
    version !== 1 ||
    domain !== config.domain ||
    paused
  )
    throw new Error(
      "The transfer provider is paused or this route changed. Your accounts are unchanged.",
    );
  return { client, blockNumber };
}
export async function cctpRequest(chainId: number, path: string) {
  const response = await fetch(`${cctpConfiguration(chainId).api}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  // Circle documents 404 before a burn is observed as a normal pending state.
  // Missing fee quotes still fail closed; only message lookups accept this.
  if (
    response.status === 404 &&
    /^\/v2\/messages\/\d+\?transactionHash=0x[\da-f]{64}$/i.test(path)
  )
    return { messages: [] };
  if (response.status === 429)
    throw new Error(
      "The transfer service is busy. Try again in a few minutes.",
    );
  if (!response.ok)
    throw new Error("The transfer service is unavailable. Try again shortly.");
  const text = await response.text();
  if (text.length > 200_000)
    throw new Error("The transfer service returned an unreadable response.");
  return JSON.parse(text) as unknown;
}
export async function quoteCctp(
  input: Pick<
    CctpQuote,
    | "reference"
    | "chainId"
    | "destinationChainId"
    | "account"
    | "destination"
    | "amount"
  >,
) {
  const { source, destination } = assertCctpRoute(
    input.chainId,
    input.destinationChainId,
  );
  const response = await cctpRequest(
    input.chainId,
    `/v2/burn/USDC/fees/${source.domain}/${destination.domain}?forward=true`,
  );
  return makeCctpQuote(input, response, Date.now());
}
export async function verifyCctpFunding(q: CctpQuote) {
  const [{ client, blockNumber }] = await Promise.all([
    verifyCctpContracts(q.chainId, q.destinationChainId),
    verifyCctpContracts(q.destinationChainId, q.chainId),
  ]);
  const balance = await client.readContract({
    address: cctpConfiguration(q.chainId).token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [q.account],
    blockNumber,
  });
  if (balance <= BigInt(q.total))
    throw new Error(
      "This account needs enough USDC for the transfer, delivery and its separate execution fee.",
    );
}
export function cctpForwardHints(response: unknown): Hex[] {
  if (
    !response ||
    typeof response !== "object" ||
    !("messages" in response) ||
    !Array.isArray(response.messages) ||
    response.messages.length > 50
  )
    throw new Error(
      "The transfer service has not supplied readable delivery information.",
    );
  return [
    ...new Set(
      response.messages.flatMap((row) =>
        row &&
        typeof row.forwardTxHash === "string" &&
        /^0x[\da-f]{64}$/i.test(row.forwardTxHash)
          ? [row.forwardTxHash as Hex]
          : [],
      ),
    ),
  ];
}
