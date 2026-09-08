import { parseAbiItem, parseEventLogs, type Log } from 'viem';
import { circleConfiguration, circleOperationHash, type CircleUserOperation } from './circleExecution';

export const circleUserOperationEvent = parseAbiItem('event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)');
export const circleChargeEvent = parseAbiItem('event UserOperationSponsored(address indexed token,address indexed sender,bytes32 userOpHash,uint256 nativeTokenPrice,uint256 actualTokenNeeded,uint256 feeTokenAmount)');
const transferEvent = parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
const beforeExecutionEvent = parseAbiItem('event BeforeExecution()');
export type CircleFeeProof = { prefund: { logIndex: number; amountRaw: string }; refund?: { logIndex: number; amountRaw: string } };
export function circleFeeTransferId(txHash: string, proof: CircleFeeProof) {
  // A compound movement explicitly identifies both USDC legs. It is not an
  // ERC-20 transfer with an invented net amount.
  return `c${txHash.slice(2).toLowerCase()}:${proof.prefund.logIndex}:${proof.refund?.logIndex ?? 'none'}`;
}

/** Only canonical on-chain evidence can settle an operation. A successful
 * bundle receipt alone does not mean every enclosed payment succeeded. The
 * caller must also check canonical block identity and confirmation depth. */
export function readCircleSettlement(chainId: number, operation: CircleUserOperation, receipt: { status: string; logs: Log[] }) {
  if (receipt.status !== 'success') throw new Error('The bundle did not settle. Check the original execution status.');
  const config = circleConfiguration(chainId), hash = circleOperationHash(chainId, operation);
  const events = parseEventLogs({ abi: [circleUserOperationEvent], logs: receipt.logs, strict: true }).filter(log => !log.removed && log.address.toLowerCase() === config.entryPoint.toLowerCase() && log.args.userOpHash.toLowerCase() === hash.toLowerCase() && log.args.sender.toLowerCase() === operation.sender.toLowerCase() && log.args.nonce === operation.nonce && log.args.paymaster.toLowerCase() === config.paymaster.toLowerCase());
  if (events.length !== 1) throw new Error('The receipt does not identify this exact account operation.');
  const charges = parseEventLogs({ abi: [circleChargeEvent], logs: receipt.logs, strict: true }).filter(log => !log.removed && log.address.toLowerCase() === config.paymaster.toLowerCase() && log.args.userOpHash.toLowerCase() === hash.toLowerCase() && log.args.sender.toLowerCase() === operation.sender.toLowerCase() && log.args.token.toLowerCase() === config.token.toLowerCase());
  if (charges.length !== 1 || charges[0].args.actualTokenNeeded < charges[0].args.feeTokenAmount) throw new Error('The provider fee could not be reconciled with this execution.');
  const validLogs = receipt.logs.filter(log => !log.removed);
  if (validLogs.some(log => !Number.isSafeInteger(log.logIndex) || log.logIndex! < 0) || new Set(validLogs.map(log => log.logIndex)).size !== validLogs.length) throw new Error('The receipt has ambiguous transfer positions');
  const boundaries = parseEventLogs({ abi: [beforeExecutionEvent], logs: validLogs, strict: true }).filter(log => log.address.toLowerCase() === config.entryPoint.toLowerCase());
  if (boundaries.length !== 1) throw new Error('The provider fee needs an unambiguous execution boundary');
  const boundary = boundaries[0].logIndex!, end = events[0].logIndex!, charge = charges[0].logIndex!;
  const operations = parseEventLogs({ abi: [circleUserOperationEvent], logs: validLogs, strict: true }).filter(log => log.address.toLowerCase() === config.entryPoint.toLowerCase()).sort((a, b) => a.logIndex! - b.logIndex!);
  const sameAccount = operations.filter(log => log.args.sender.toLowerCase() === operation.sender.toLowerCase() && log.args.paymaster.toLowerCase() === config.paymaster.toLowerCase());
  const ordinal = sameAccount.findIndex(log => log.args.userOpHash.toLowerCase() === hash.toLowerCase());
  const transfers = parseEventLogs({ abi: [transferEvent], logs: validLogs, strict: true }).filter(log => log.address.toLowerCase() === config.token.toLowerCase()).sort((a, b) => a.logIndex! - b.logIndex!);
  const prefunds = transfers.filter(log => log.logIndex! < boundary && log.args.from.toLowerCase() === operation.sender.toLowerCase() && log.args.to.toLowerCase() === config.paymaster.toLowerCase());
  const start = Math.max(boundary, ...operations.filter(log => log.logIndex! < end).map(log => log.logIndex!));
  const refunds = transfers.filter(log => log.logIndex! > start && log.logIndex! < charge && log.args.from.toLowerCase() === config.paymaster.toLowerCase() && log.args.to.toLowerCase() === operation.sender.toLowerCase());
  if (ordinal < 0 || prefunds.length !== sameAccount.length || refunds.length > 1 || charge <= start || charge >= end) throw new Error('The provider fee could not be matched to its transfers');
  const prefund = prefunds[ordinal], refund = refunds[0];
  if (prefund.args.value - (refund?.args.value ?? 0n) !== charges[0].args.actualTokenNeeded) throw new Error('The fee charge does not equal the collected amount less its refund');
  const feeProof: CircleFeeProof = { prefund: { logIndex: prefund.logIndex!, amountRaw: String(prefund.args.value) },
    ...(refund ? { refund: { logIndex: refund.logIndex!, amountRaw: String(refund.args.value) } } : {}) };
  return { status: events[0].args.success ? 'confirmed' as const : 'failed' as const, token: 'USDC' as const, fee: charges[0].args.actualTokenNeeded, feeProof, providerMarkup: charges[0].args.feeTokenAmount, nativeGas: events[0].args.actualGasCost, userOpHash: hash, executionStart: start, executionEnd: end };
}
