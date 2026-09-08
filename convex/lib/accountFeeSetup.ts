import { getCompatibilityFallbackHandlerDeployments } from "@safe-global/safe-deployments";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  stringToHex,
  zeroAddress,
  type Address,
} from "viem";
import {
  SAFE_4337_MODULE,
  supportedSafe4337Handler,
} from "../../shared/safe4337";
import { USDC_WALLET_CHAINS } from "../../shared/walletCalls";
import { getChainClient } from "./safeVerification";
import { prepareAccountCalls } from "./accountApproval";
import type { AccountAuthority } from "./accountAuthority";
import { assertExactAccountChange } from "./accountChange";
import type { PreparedOwnerProposal } from "../../shared/ownerProposal";

const abi = parseAbi([
  "function isModuleEnabled(address module) view returns(bool)",
  "function enableModule(address module)",
  "function setFallbackHandler(address handler)",
]);
export async function inspectAccountFeeSetup(
  chainId: number,
  safe: string,
  blockNumber: bigint,
) {
  if (!(USDC_WALLET_CHAINS as readonly number[]).includes(chainId))
    throw new Error("Enable USDC fees with MetaMask on Base or Arbitrum.");
  const client = getChainClient(chainId),
    address = getAddress(safe);
  const [slot, enabled, code] = await Promise.all([
    client.getStorageAt({
      address,
      slot: keccak256(stringToHex("fallback_manager.handler.address")),
      blockNumber,
    }),
    client.readContract({
      address,
      abi,
      functionName: "isModuleEnabled",
      args: [SAFE_4337_MODULE],
      blockNumber,
    }),
    client.getCode({ address: SAFE_4337_MODULE, blockNumber }),
  ]);
  if (
    !slot ||
    slot.length !== 66 ||
    typeof enabled !== "boolean" ||
    !supportedSafe4337Handler(chainId, SAFE_4337_MODULE, code)
  )
    throw new Error(
      "The account fee service could not be verified. Try again shortly.",
    );
  const handler = getAddress(`0x${slot.slice(-40)}`);
  if (
    handler !== zeroAddress &&
    handler.toLowerCase() !== SAFE_4337_MODULE.toLowerCase()
  ) {
    const handlerCode = await client.getCode({ address: handler, blockNumber });
    const supported = ["1.3.0", "1.4.1"].some((version) => {
      const d = getCompatibilityFallbackHandlerDeployments({
        version,
        network: String(chainId),
      });
      return Object.values(d?.deployments ?? {}).some(
        (p) =>
          p?.address.toLowerCase() === handler.toLowerCase() &&
          handlerCode &&
          p.codeHash === keccak256(handlerCode),
      );
    });
    if (!supported)
      throw new Error(
        "This account uses a custom signature handler. Its existing integrations need review before enabling USDC fees.",
      );
  }
  return {
    handler,
    enabled,
    ready: enabled && handler.toLowerCase() === SAFE_4337_MODULE.toLowerCase(),
  };
}
export function accountFeeSetupTransaction(
  chainId: number,
  safe: string,
  state: { handler: string; enabled: boolean },
  nonce: number,
) {
  const calls: Array<{ to: Address; data: `0x${string}` }> = [];
  if (!state.enabled)
    calls.push({
      to: getAddress(safe),
      data: encodeFunctionData({
        abi,
        functionName: "enableModule",
        args: [SAFE_4337_MODULE],
      }),
    });
  if (state.handler.toLowerCase() !== SAFE_4337_MODULE.toLowerCase())
    calls.push({
      to: getAddress(safe),
      data: encodeFunctionData({
        abi,
        functionName: "setFallbackHandler",
        args: [SAFE_4337_MODULE],
      }),
    });
  if (!calls.length)
    throw new Error("This account already supports USDC execution fees.");
  return prepareAccountCalls(chainId, calls, nonce);
}
export async function verifyAccountFeeSetup(
  setup: {
    chainId: number;
    safeAddress: string;
    handler: string;
    enabled: boolean;
    proposal: PreparedOwnerProposal;
  },
  authority: AccountAuthority,
) {
  const state = await inspectAccountFeeSetup(
    setup.chainId,
    setup.safeAddress,
    BigInt(authority.blockNumber),
  );
  if (
    state.handler.toLowerCase() !== setup.handler.toLowerCase() ||
    state.enabled !== setup.enabled
  )
    throw new Error(
      "The account service configuration changed. Check the original setup before continuing.",
    );
  if (authority.nodes[0].nonce !== setup.proposal.safeTransactionData.nonce)
    throw new Error(
      "The account transaction number changed. Check the original setup before continuing.",
    );
  await assertExactAccountChange(
    setup.chainId,
    setup.safeAddress,
    accountFeeSetupTransaction(
      setup.chainId,
      setup.safeAddress,
      setup,
      setup.proposal.safeTransactionData.nonce,
    ),
    setup.proposal,
    authority,
  );
}
