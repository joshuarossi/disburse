import { hashMessage, type Hex } from "viem";
import { recoverAddress } from "./signatures";

export function verifiedOwnerSignatures(
  hash: Hex,
  owners: string[],
  confirmations: Array<{ owner: string; signature: string }>,
) {
  const confirmed = new Set<string>();
  for (const confirmation of confirmations) {
    if (!/^0x[0-9a-fA-F]{130}$/.test(confirmation.signature))
      throw new Error(
        "This account uses a signature type not yet supported in Disburse.",
      );
    const v = parseInt(confirmation.signature.slice(-2), 16);
    if (![27, 28, 31, 32].includes(v))
      throw new Error("Unsupported account signature type.");
    const signature = (
      v > 30
        ? confirmation.signature.slice(0, -2) + (v - 4).toString(16)
        : confirmation.signature
    ) as Hex;
    const recovered = recoverAddress({
      hash: v > 30 ? hashMessage({ raw: hash }) : hash,
      signature,
    }).toLowerCase();
    if (recovered !== confirmation.owner.toLowerCase())
      throw new Error(
        "A proposal signature is not from a current account owner",
      );
    if (owners.some((owner) => owner.toLowerCase() === recovered)) confirmed.add(recovered);
  }
  return [...confirmed];
}
