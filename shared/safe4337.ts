import { getSafe4337ModuleDeployment, getSafeModuleSetupDeployment } from '@safe-global/safe-modules-deployments';
import { encodeFunctionData, getAddress, isAddress, keccak256, parseAbi, zeroAddress, type Address, type Hex } from 'viem';

export const SAFE_4337_MODULE = '0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226' as const;
export const SAFE_4337_SETUP = '0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47' as const;
// Released Safe4337Module 0.3.0, verified against its exact-match Solidity
// compilation on Sourcify and identical deployed runtime on Ethereum and Base
// Sepolia. The address alone is insufficient to trust a signature handler.
// https://sourcify.dev/server/v2/contract/1/0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226
export const SAFE_4337_CODE_HASH = '0x2aea997c4e3cf0e2f333025372e219abcfde81c21fc2f8fb066414a5685dd3e0' as const;

function publishedOn(chainId: number) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return false;
  const module = getSafe4337ModuleDeployment({ version: '0.3.0', network: String(chainId) });
  const setup = getSafeModuleSetupDeployment({ version: '0.3.0', network: String(chainId) });
  return !!module?.released && !!setup?.released &&
    module.networkAddresses[String(chainId)]?.toLowerCase() === SAFE_4337_MODULE.toLowerCase() &&
    setup.networkAddresses[String(chainId)]?.toLowerCase() === SAFE_4337_SETUP.toLowerCase();
}

export function supportedSafe4337Handler(chainId: number, handler: string, code: Hex | undefined) {
  return !!code && code !== '0x' && publishedOn(chainId) &&
    handler.toLowerCase() === SAFE_4337_MODULE.toLowerCase() && keccak256(code) === SAFE_4337_CODE_HASH;
}

/** Keep the company's chosen owners and threshold. The module validates every
 * operation with that Safe's current signatures; Disburse gains no authority. */
export function customerPaidSafeConfig(chainId: number, owners: string[], threshold: number) {
  if (!publishedOn(chainId)) throw new Error('Account creation with stablecoin fees is not available on this network');
  if (!owners.length || owners.length > 50 || owners.some(owner => !isAddress(owner) || owner.toLowerCase() === zeroAddress) ||
    new Set(owners.map(owner => owner.toLowerCase())).size !== owners.length ||
    !Number.isSafeInteger(threshold) || threshold < 1 || threshold > owners.length) {
    throw new Error('Choose valid, distinct account owners and an approval threshold within that owner count');
  }
  return {
    owners: owners.map(owner => getAddress(owner)), threshold,
    to: SAFE_4337_SETUP as Address,
    data: encodeFunctionData({ abi: parseAbi(['function enableModules(address[] modules)']), functionName: 'enableModules', args: [[SAFE_4337_MODULE]] }),
    fallbackHandler: SAFE_4337_MODULE as Address,
  };
}
