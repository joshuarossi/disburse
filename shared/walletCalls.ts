import {
  encodeAbiParameters,
  encodeFunctionData,
  isAddress,
  isHex,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";

export const USDC_WALLET_CHAINS = [8453, 42161] as const;
export type WalletCalls = {
  chainId: number;
  payer: Address;
  calls: Array<{ to: Address; data: Hex }>;
};

/** Only the customer's wallet submits this atomic, zero-native-value request.
 * The customer chooses USDC and reviews MetaMask's complete fee there. */
export function customerWalletBatch(intent: WalletCalls, batchId: Hex) {
  if (!(USDC_WALLET_CHAINS as readonly number[]).includes(intent.chainId))
    throw new Error("Wallet fees in USDC are available on Base and Arbitrum.");
  if (
    !isAddress(intent.payer) ||
    !/^0x[\da-f]{64}$/i.test(batchId) ||
    !intent.calls.length ||
    intent.calls.length > 201 ||
    intent.calls.some(
      (c) =>
        !isAddress(c.to) ||
        !isHex(c.data, { strict: true }) ||
        c.data.length % 2,
    )
  )
    throw new Error(
      "The saved wallet request is invalid. Review the original request.",
    );
  return {
    version: "2.0.0",
    id: batchId,
    from: intent.payer,
    chainId: toHex(intent.chainId),
    atomicRequired: true,
    calls: intent.calls.map((c) => ({ ...c, value: "0x0" })),
  };
}

/** Used only to identify a reverted wallet transaction, never to broadcast it. */
export function customerWalletExecutionData(intent: WalletCalls) {
  const batch = customerWalletBatch(intent, `0x${"00".repeat(32)}`);
  return encodeFunctionData({
    abi: parseAbi(["function execute(bytes32 mode,bytes executionData)"]),
    functionName: "execute",
    args: [
      `0x01${"00".repeat(31)}`,
      encodeAbiParameters(
        [
          {
            type: "tuple[]",
            components: [
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
          },
        ],
        [batch.calls.map((c) => ({ to: c.to, value: 0n, data: c.data }))],
      ),
    ],
  });
}
