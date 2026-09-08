import { concatHex, encodeAbiParameters, encodeFunctionData, erc20Abi, isAddress, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { getUserOperationHash } from 'viem/account-abstraction';
import type { GetQuotePayload } from '@biconomy/abstractjs';
import { CHAIN_TOKENS, type SupportedChainId } from './chains';

export const CUSTOMER_EXECUTION_URL = 'https://network.biconomy.io/v1';
export const CUSTOMER_EXECUTION_VERSION = '2.2.3';
export const CUSTOMER_EXECUTION_CHAINS = [1, 137, 8453, 42161, 84532] as const;
export const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const;
export const MAX_SETUP_FEE = 20_000_000n;
const executeAbi = parseAbi(['function execute(bytes32 mode, bytes executionCalldata)']);
export type ServiceCall = { to: Address; data: Hex; value: bigint };
export type CustomerExecutionIntent = {
  chainId: number; owner: Address; companion: Address; token: Address;
  amount: bigint; calls: ServiceCall[]; initCode: Hex;
  validAfter: number; validUntil: number;
};

export class ServiceExecutionError extends Error {
  constructor(public readonly code: 'unsupported' | 'unavailable' | 'invalid_quote' | 'expired' | 'balance' | 'wallet_changed' | 'pending' | 'storage', message: string) {
    super(message); this.name = 'ServiceExecutionError';
  }
}

/** Only reverting CALL mode: no delegatecall, try/catch, injected calls or arbitrary approvals. */
export function encodeServiceCalls(calls: ServiceCall[]): Hex {
  if (!calls.length) throw new Error('An execution needs at least one call');
  const batch = calls.length > 1;
  const data = batch
    ? encodeAbiParameters([{ type: 'tuple[]', components: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }], [calls])
    : concatHex([calls[0].to, `0x${calls[0].value.toString(16).padStart(64, '0')}`, calls[0].data]);
  return encodeFunctionData({ abi: executeAbi, functionName: 'execute', args: [`0x${batch ? '01' : '00'}${'00'.repeat(31)}`, data] });
}
export function tokenPull(token: Address, from: Address, to: Address, amount: bigint): ServiceCall {
  return { to: token, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transferFrom', args: [from, to, amount] }) };
}
const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const hex = (v: unknown, bytes?: number): v is Hex => typeof v === 'string' && /^0x(?:[a-f\d]{2})*$/i.test(v) && (bytes === undefined || v.length === 2 + bytes * 2);
function uint(v: unknown, bits = 256): bigint {
  if ((typeof v !== 'string' || !/^\d+$/.test(v)) && (typeof v !== 'number' || !Number.isSafeInteger(v))) throw new Error('Invalid integer');
  const n = BigInt(v); if (n < 0n || n >= 2n ** BigInt(bits)) throw new Error('Invalid integer'); return n;
}

/** Verify the actual signed operations, not the provider's display metadata.
 * MEE v2.2.3 uses EP 0.7 hashes and double-hashed (hash, validAfter, validUntil)
 * Merkle leaves: bcnmy/mee-contracts/contracts/lib/util/MEEUserOpHashLib.sol. */
export function verifyCustomerQuote(value: unknown, intent: CustomerExecutionIntent, now = Date.now()): { quote: GetQuotePayload; fee: bigint; debit: bigint; expiresAt: number } {
  try {
    if (!CUSTOMER_EXECUTION_CHAINS.includes(intent.chainId as typeof CUSTOMER_EXECUTION_CHAINS[number]) || intent.amount < 0n || intent.calls.length < 1 || intent.calls.length > 202) throw new Error();
    if (!same(intent.token, CHAIN_TOKENS[intent.chainId as SupportedChainId].USDC.address) || !isAddress(intent.owner) || !isAddress(intent.companion) || intent.amount >= 2n ** 256n || intent.calls.some(call => call.value !== 0n)) throw new Error();
    const q = value as GetQuotePayload;
    if (!q || q.quoteType !== 'permit' || !hex(q.hash, 32) || !isAddress(q.node) || !hex(q.commitment, 65) || q.userOps?.length !== 2) throw new Error();
    const p = q.paymentInfo;
    if (!p || p.sponsored !== false || p.sponsorshipUrl || p.eip7702Auth || !same(p.sender, intent.companion) || !same(p.eoa, intent.owner) || !same(p.token, intent.token) || !same(p.gasRefundAddress, intent.owner) || uint(p.chainId) !== BigInt(intent.chainId) || !same(p.initCode, intent.initCode)) throw new Error();
    const fee = uint(p.tokenWeiAmount);
    if (fee <= 0n || fee > MAX_SETUP_FEE) throw new Error();
    const expected = [encodeServiceCalls([tokenPull(intent.token, intent.owner, q.node, fee)]), encodeServiceCalls([tokenPull(intent.token, intent.owner, intent.companion, intent.amount), ...intent.calls])];
    const leaves: Hex[] = [];
    let expiresAt = intent.validUntil * 1000;
    for (const [index, detail] of q.userOps.entries()) {
      const op = detail.userOp;
      if (uint(detail.chainId) !== BigInt(intent.chainId) || detail.isCleanUpUserOp || detail.eip7702Auth || detail.shortEncoding || detail.sessionDetails || !op || op.signature || !same(op.sender, intent.companion) || !same(op.callData, expected[index]) || !same(op.initCode, index === 0 ? intent.initCode : '0x')) throw new Error();
      if (!hex(op.paymasterAndData) || op.paymasterAndData.length !== 162 || !same(`0x${op.paymasterAndData.slice(106)}`, `0x170de0019ee4ce01${intent.owner.slice(2)}`)) throw new Error();
      const lower = uint(detail.lowerBoundTimestamp, 48), upper = uint(detail.upperBoundTimestamp, 48);
      if (upper <= lower || upper > BigInt(intent.validUntil) || (index === 1 && (lower !== BigInt(intent.validAfter) || upper !== BigInt(intent.validUntil)))) throw new Error();
      expiresAt = Math.min(expiresAt, Number(upper) * 1000);
      const operationHash = getUserOperationHash({ entryPointAddress: ENTRY_POINT, entryPointVersion: '0.7', chainId: intent.chainId, userOperation: {
        sender: op.sender, nonce: uint(op.nonce), callData: op.callData,
        ...(op.initCode === '0x' ? {} : { factory: op.initCode.slice(0, 42) as Address, factoryData: `0x${op.initCode.slice(42)}` as Hex }),
        callGasLimit: uint(op.callGasLimit, 128), verificationGasLimit: uint(op.verificationGasLimit, 128), preVerificationGas: uint(op.preVerificationGas), maxFeePerGas: uint(op.maxFeePerGas, 128), maxPriorityFeePerGas: uint(op.maxPriorityFeePerGas, 128),
        paymaster: op.paymasterAndData.slice(0, 42) as Address,
        paymasterVerificationGasLimit: BigInt(`0x${op.paymasterAndData.slice(42, 74)}`), paymasterPostOpGasLimit: BigInt(`0x${op.paymasterAndData.slice(74, 106)}`), paymasterData: `0x${op.paymasterAndData.slice(106)}` as Hex, signature: '0x',
      } });
      const leaf = keccak256(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }], [operationHash, lower, upper])));
      if (!same(operationHash, detail.userOpHash) || !same(leaf, detail.meeUserOpHash)) throw new Error();
      leaves.push(leaf);
    }
    if (q.userOps[0].userOp.nonce !== p.nonce || q.userOps[0].userOp.nonce === q.userOps[1].userOp.nonce || !same(keccak256(concatHex(leaves.sort())), q.hash)) throw new Error();
    if (expiresAt < now + 30_000) throw new ServiceExecutionError('expired', 'This fee quote has expired. Refresh the quote before approving.');
    return { quote: q, fee, debit: intent.amount + fee, expiresAt };
  } catch (error) {
    if (error instanceof ServiceExecutionError) throw error;
    throw new ServiceExecutionError('invalid_quote', 'The execution service returned a quote that does not match your instructions. Nothing was sent. Request a new quote.');
  }
}
