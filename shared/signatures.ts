// Static imports are required by the Convex runtime. Viem's recovery helper
// dynamically imports this same curve implementation and fails in deployed functions.
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  getAddress,
  hashMessage,
  keccak256,
  type Address,
  type Hex,
} from "viem";

export function recoverAddress({
  hash,
  signature,
}: {
  hash: Hex;
  signature: Hex;
}): Address {
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(hash) ||
    !/^0x[0-9a-fA-F]{130}$/.test(signature)
  )
    throw new Error("Invalid message hash or signature length");
  const v = Number.parseInt(signature.slice(-2), 16);
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1)
    throw new Error("Invalid signature recovery bit");
  const publicKey = secp256k1.Signature.fromCompact(signature.slice(2, 130))
    .addRecoveryBit(recovery)
    .recoverPublicKey(hash.slice(2))
    .toHex(false);
  return getAddress(`0x${keccak256(`0x${publicKey.slice(2)}`).slice(-40)}`);
}

export function verifyMessage({
  address,
  message,
  signature,
}: {
  address: Address;
  message: string;
  signature: Hex;
}): boolean {
  try {
    return (
      recoverAddress({
        hash: hashMessage(message),
        signature,
      }).toLowerCase() === address.toLowerCase()
    );
  } catch {
    return false;
  }
}
