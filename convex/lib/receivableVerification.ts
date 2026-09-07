import { isAddress, keccak256 } from "viem";
import { getChainClient } from "./safeVerification";
import { forwarderFactory } from "../../shared/receivableAddress";

export function invoiceTestnet(chainId: number) {
  return [11155111, 84532].includes(chainId);
}

export async function verifyInvoiceFactory(chainId: number, factory: string) {
  if (!isAddress(factory))
    throw new Error(
      "Invoice receiving addresses are not configured for this network.",
    );
  const client = getChainClient(chainId);
  if ((await client.getChainId()) !== chainId)
    throw new Error("Receiving network does not match the configured network.");
  const code = await client.getCode({ address: factory });
  if (!code || keccak256(code) !== keccak256(forwarderFactory.deployedBytecode))
    throw new Error(
      "The receiving address factory could not be verified. No payment address was issued.",
    );
  return client;
}
