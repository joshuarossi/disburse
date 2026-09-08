import { keccak256, parseAbi, stringToHex, type Address } from 'viem';
import { SAFE_4337_MODULE, supportedSafe4337Handler } from '../../shared/safe4337';
import type { getChainClient } from './safeVerification';

/** Account identity and ownership are checked separately. Both the module and
 * fallback handler must be present for the published Safe4337 validation path. */
export async function assertCustomerPaidAccount(client: ReturnType<typeof getChainClient>, address: Address, chainId: number, blockNumber: bigint) {
  const [handler, enabled, code] = await Promise.all([
    client.getStorageAt({ address, slot: keccak256(stringToHex('fallback_manager.handler.address')), blockNumber }),
    client.readContract({ address, abi: parseAbi(['function isModuleEnabled(address module) view returns (bool)']), functionName: 'isModuleEnabled', args: [SAFE_4337_MODULE], blockNumber }),
    client.getCode({ address: SAFE_4337_MODULE, blockNumber }),
  ]);
  if (!enabled || !handler || handler.length !== 66 || !supportedSafe4337Handler(chainId, `0x${handler.slice(-40)}`, code)) {
    throw new Error('This account is not configured for stablecoin execution fees. Review its account setup before continuing.');
  }
}
