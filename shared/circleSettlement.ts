import { parseAbiItem, parseEventLogs, type Log } from 'viem';
import { circleConfiguration, circleOperationHash, type CircleUserOperation } from './circleExecution';

export const circleUserOperationEvent = parseAbiItem('event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)');
export const circleChargeEvent = parseAbiItem('event UserOperationSponsored(address indexed token,address indexed sender,bytes32 userOpHash,uint256 nativeTokenPrice,uint256 actualTokenNeeded,uint256 feeTokenAmount)');

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
  return { status: events[0].args.success ? 'confirmed' as const : 'failed' as const, token: 'USDC' as const, fee: charges[0].args.actualTokenNeeded, providerMarkup: charges[0].args.feeTokenAmount, nativeGas: events[0].args.actualGasCost, userOpHash: hash };
}
