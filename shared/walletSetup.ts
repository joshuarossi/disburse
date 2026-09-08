import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getContractAddress,
  keccak256,
  concatHex,
  encodeAbiParameters,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  safeAccountDeployment,
  companyFactoryAbi,
} from "./companyAccountSetup";
import { circleConfiguration } from "./circleExecution";

// MetaMask's own gas-included service supports these mainnets. Its documented
// list excludes testnets. Restrict new company accounts to networks where their
// subsequent Safe transactions can use the integrated USDC paymaster too.
// https://support.metamask.io/manage-crypto/transactions/metamask-gas-station/
export const WALLET_SETUP_CHAINS = [8453, 42161] as const;
export type WalletSetupIntent = {
  chainId: number;
  payer: Address;
  owners: Address[];
  threshold: number;
  salt: Hex;
  address: Address;
  deposit: string;
};
export function walletSetupCall(intent: Omit<WalletSetupIntent, "address">) {
  if (!(WALLET_SETUP_CHAINS as readonly number[]).includes(intent.chainId))
    throw new Error(
      "Account setup with fees in USDC is available on Base and Arbitrum.",
    );
  if (!/^(0|[1-9]\d{0,29})$/.test(intent.deposit))
    throw new Error("Enter a valid company account deposit.");
  if (
    !intent.owners.some(
      (owner) => owner.toLowerCase() === intent.payer.toLowerCase(),
    )
  )
    throw new Error("Include your connected wallet as an account owner.");
  return safeAccountDeployment(
    intent.chainId,
    intent.owners,
    intent.threshold,
    intent.salt,
  );
}
export function predictedWalletSafe(
  intent: Omit<WalletSetupIntent, "address">,
  proxyCreationCode: Hex,
) {
  const call = walletSetupCall(intent);
  const {
    args: [singleton, initializer, nonce],
  } = decodeFunctionData({ abi: companyFactoryAbi, data: call.data });
  return getContractAddress({
    from: call.to,
    opcode: "CREATE2",
    salt: keccak256(
      concatHex([keccak256(initializer), toHex(nonce, { size: 32 })]),
    ),
    bytecodeHash: keccak256(
      concatHex([
        proxyCreationCode,
        encodeAbiParameters([{ type: "address" }], [singleton]),
      ]),
    ),
  });
}
/** The wallet receives the exact deployment and deposit as one atomic batch.
 * The deterministic deployment reverts if the same setup was already mined,
 * so its deposit cannot be sent twice by a delayed or duplicated batch. */
export function walletSetupBatch(intent: WalletSetupIntent, batchId: Hex) {
  const call = walletSetupCall(intent),
    token = circleConfiguration(intent.chainId).token;
  const calls = [{ to: call.to, data: call.data, value: "0x0" }];
  if (BigInt(intent.deposit))
    calls.push({
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [intent.address, BigInt(intent.deposit)],
      }),
      value: "0x0",
    });
  return {
    version: "2.0.0",
    id: batchId,
    from: intent.payer,
    chainId: toHex(intent.chainId),
    atomicRequired: true,
    calls,
  };
}

/** MetaMask's published ERC-7821 encoding. A failed transaction only releases
 * this setup if the payer signed these exact calls on the correct network. */
export function walletSetupExecutionData(intent: WalletSetupIntent) {
  const batch = walletSetupBatch(intent, `0x${"00".repeat(32)}`);
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
        [
          batch.calls.map((call) => ({
            to: call.to,
            value: 0n,
            data: call.data,
          })),
        ],
      ),
    ],
  });
}

export function parseWalletBatchStatus(value: unknown, expectedChain: number) {
  if (!value || typeof value !== "object")
    throw new Error(
      "MetaMask returned an unreadable setup status. Keep this request and check it again.",
    );
  const s = value as Record<string, unknown>;
  if (
    Number(s.chainId) !== expectedChain ||
    !Number.isInteger(s.status) ||
    (s.status as number) < 100 ||
    (s.status as number) > 599
  )
    throw new Error(
      "MetaMask returned an unexpected setup status. Check the original request again.",
    );
  const receipts = Array.isArray(s.receipts) ? s.receipts : [];
  if (
    receipts.length > 1 ||
    receipts.some(
      (r) =>
        !r ||
        typeof r !== "object" ||
        !/^0x[\da-f]{64}$/i.test(
          (r as { transactionHash?: string }).transactionHash ?? "",
        ),
    )
  )
    throw new Error(
      "MetaMask returned unexpected setup receipts. Check the original request again.",
    );
  // Never use a wallet status as proof of successful settlement. The server
  // independently reads the canonical receipt and the resulting Safe authority.
  return {
    status: s.status as number,
    txHash: receipts.length
      ? (receipts[0] as { transactionHash: Hex }).transactionHash
      : undefined,
  };
}
