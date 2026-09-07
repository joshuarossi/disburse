import {
  allowanceDeployments,
  assertCurrentAllowance,
  assertAllowanceRuntime,
} from "./allowanceDeployments";
export type { AllowanceDeployment } from "./allowanceDeployments";
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { CHAIN_TOKENS, type SupportedChainId } from "./chains";
import { amountToBaseUnits } from "./validation";

export const allowanceAbi = parseAbi([
  "function addDelegate(address delegate)",
  "function setAllowance(address delegate,address token,uint96 amount,uint16 resetTimeMin,uint32 resetBaseMin)",
  "function deleteAllowance(address delegate,address token)",
  "function getDelegates(address safe,uint48 start,uint8 pageSize) view returns (address[] results,uint48 next)",
  "function getTokens(address safe,address delegate) view returns (address[])",
  "function getTokenAllowance(address safe,address delegate,address token) view returns (uint256[5])",
  "function delegates(address safe,uint48 index) view returns (address delegate,uint48 prev,uint48 next)",
]);
export const safeModuleAbi = parseAbi([
  "function enableModule(address module)",
  "function isModuleEnabled(address module) view returns (bool)",
  "function getOwners() view returns (address[])",
  "function VERSION() view returns (string)",
]);
export const ALLOWANCE_PERIODS = [
  { label: "One-time allowance", minutes: 0 },
  { label: "Every day", minutes: 1440 },
  { label: "Every 7 days", minutes: 10080 },
  { label: "Every 30 days", minutes: 43200 },
] as const;
export const getAllowanceDeployments = allowanceDeployments;
function assertModule(chainId: number, module: string) {
  if (
    !getAllowanceDeployments(chainId).some(
      (d) => d.address.toLowerCase() === module.toLowerCase(),
    )
  )
    throw new Error("Unsupported allowance module for this network");
}
function checkedDelegate(value: string, safe: string) {
  const delegate = getAddress(value);
  if (delegate === zeroAddress || delegate.toLowerCase() === safe.toLowerCase())
    throw new Error("Choose a separate delegate wallet");
  return delegate;
}
export function buildAllowanceGrant(input: {
  chainId: number;
  safe: string;
  module: string;
  delegate: string;
  token: string;
  amount: string;
  resetMinutes: number;
  moduleEnabled: boolean;
  delegateExists: boolean;
}) {
  assertModule(input.chainId, input.module);
  assertCurrentAllowance(input.chainId, input.module);
  const safe = getAddress(input.safe),
    module = getAddress(input.module),
    delegate = checkedDelegate(input.delegate, safe);
  const token = Object.values(
    CHAIN_TOKENS[input.chainId as SupportedChainId] ?? {},
  ).find((t) => t.symbol === input.token);
  if (!token) throw new Error("Currency is unavailable on this network");
  const amount = amountToBaseUnits(input.amount, input.token);
  if (amount <= 0n || amount >= 2n ** 96n)
    throw new Error(
      "Allowance must be positive and fit the contract amount limit",
    );
  if (!ALLOWANCE_PERIODS.some((p) => p.minutes === input.resetMinutes))
    throw new Error("Unsupported reset period");
  const transactions: Array<{
    to: string;
    value: string;
    data: string;
    operation: number;
  }> = [];
  const call = (to: string, data: string) =>
    transactions.push({ to, value: "0", data, operation: 0 });
  if (!input.moduleEnabled)
    call(
      safe,
      encodeFunctionData({
        abi: safeModuleAbi,
        functionName: "enableModule",
        args: [module],
      }),
    );
  if (!input.delegateExists)
    call(
      module,
      encodeFunctionData({
        abi: allowanceAbi,
        functionName: "addDelegate",
        args: [delegate],
      }),
    );
  call(
    module,
    encodeFunctionData({
      abi: allowanceAbi,
      functionName: "setAllowance",
      args: [delegate, token.address, amount, input.resetMinutes, 0],
    }),
  );
  return transactions;
}
export function buildAllowanceRevocation(
  chainId: number,
  module: string,
  delegate: string,
  token: string,
) {
  assertModule(chainId, module);
  return [
    {
      to: getAddress(module),
      value: "0",
      data: encodeFunctionData({
        abi: allowanceAbi,
        functionName: "deleteAllowance",
        args: [getAddress(delegate), getAddress(token)],
      }),
      operation: 0,
    },
  ];
}
export type OnchainAllowance = {
  delegate: Address;
  token: Address;
  amount: bigint;
  spent: bigint;
  resetMinutes: number;
  lastResetMinutes: number;
  nonce: bigint;
};
export type AllowanceSnapshot = {
  moduleEnabled: boolean;
  delegates: Address[];
  owners: Address[];
  allowances: OnchainAllowance[];
  blockNumber: bigint;
  safeVersion: string;
};
/** One block snapshot; discovers delegates independently of current app membership. */
export async function readAllowanceState(
  client: Pick<PublicClient, "getBlockNumber" | "getCode" | "readContract">,
  chainId: number,
  safeAddress: string,
  moduleAddress: string,
  onlyDelegate?: string,
  atBlock?: bigint,
): Promise<AllowanceSnapshot> {
  assertModule(chainId, moduleAddress);
  if (!(chainId in CHAIN_TOKENS)) throw new Error("Unsupported network");
  const safe = getAddress(safeAddress),
    module = getAddress(moduleAddress);
  const blockNumber = atBlock ?? (await client.getBlockNumber());
  const code = await client.getCode({ address: module, blockNumber });
  assertAllowanceRuntime(module, code);
  const [moduleEnabled, owners, safeVersion] = await Promise.all([
    client.readContract({
      address: safe,
      abi: safeModuleAbi,
      functionName: "isModuleEnabled",
      args: [module],
      blockNumber,
    }),
    client.readContract({
      address: safe,
      abi: safeModuleAbi,
      functionName: "getOwners",
      blockNumber,
    }),
    client.readContract({
      address: safe,
      abi: safeModuleAbi,
      functionName: "VERSION",
      blockNumber,
    }),
  ]);
  const delegates: Address[] = [];
  let cursor = 0;
  const seen = new Set<number>();
  if (onlyDelegate) {
    const delegate = getAddress(onlyDelegate);
    const [registered] = await client.readContract({
      address: module,
      abi: allowanceAbi,
      functionName: "delegates",
      args: [safe, Number(BigInt(delegate) & ((1n << 48n) - 1n))],
      blockNumber,
    });
    if (registered.toLowerCase() === delegate.toLowerCase())
      delegates.push(delegate);
  } else
    do {
      if (seen.has(cursor) || seen.size >= 40)
        throw new Error(
          "Delegate list could not be loaded completely. Review this module in Safe.",
        );
      seen.add(cursor);
      const [page, next] = await client.readContract({
        address: module,
        abi: allowanceAbi,
        functionName: "getDelegates",
        args: [safe, cursor, 50],
        blockNumber,
      });
      delegates.push(...page);
      cursor = next;
    } while (cursor !== 0);
  const allowances: OnchainAllowance[] = [];
  // Bound concurrency to avoid exhausting public RPC limits.
  for (const delegate of onlyDelegate
    ? [getAddress(onlyDelegate)]
    : delegates) {
    const tokens = await client.readContract({
      address: module,
      abi: allowanceAbi,
      functionName: "getTokens",
      args: [safe, delegate],
      blockNumber,
    });
    if (tokens.length > 100 || allowances.length + tokens.length > 1000)
      throw new Error(
        "This spending policy is too large to inspect completely. Narrow the check to one member.",
      );
    for (const token of tokens) {
      const [amount, spent, reset, lastReset, nonce] =
        await client.readContract({
          address: module,
          abi: allowanceAbi,
          functionName: "getTokenAllowance",
          args: [safe, delegate, token],
          blockNumber,
        });
      if (amount > 0n)
        allowances.push({
          delegate,
          token,
          amount,
          spent,
          resetMinutes: Number(reset),
          lastResetMinutes: Number(lastReset),
          nonce,
        });
    }
  }
  return {
    moduleEnabled,
    owners: [...owners],
    delegates,
    allowances,
    blockNumber,
    safeVersion,
  };
}
