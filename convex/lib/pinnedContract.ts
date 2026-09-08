import { keccak256, zeroAddress, type Address, type Hex } from "viem";
import type { getChainClient } from "./safeVerification";

const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export async function verifyPinnedContract(
  client: Pick<ReturnType<typeof getChainClient>, "getCode" | "getStorageAt">,
  blockNumber: bigint,
  pin: {
    address: Address;
    codeHash: Hex;
    implementation: Address;
    implementationCodeHash: Hex | null;
  },
  message: string,
) {
  const code = await client.getCode({ address: pin.address, blockNumber });
  if (!code || keccak256(code) !== pin.codeHash) throw new Error(message);
  if (pin.implementation.toLowerCase() === zeroAddress) return;
  const storage = await client.getStorageAt({
    address: pin.address,
    slot: implementationSlot,
    blockNumber,
  });
  const implementation = `0x${storage?.slice(-40)}` as Address;
  if (implementation.toLowerCase() !== pin.implementation.toLowerCase())
    throw new Error(message);
  const implementationCode = await client.getCode({
    address: implementation,
    blockNumber,
  });
  if (
    !implementationCode ||
    keccak256(implementationCode) !== pin.implementationCodeHash
  )
    throw new Error(message);
}
