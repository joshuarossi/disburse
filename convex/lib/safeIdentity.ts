import { getProxyFactoryDeployments, getSafeSingletonDeployments, getSafeL2SingletonDeployments } from '@safe-global/safe-deployments';
import { concatHex, encodeAbiParameters, keccak256, parseAbi, type Address } from 'viem';
import type { getChainClient } from './safeVerification';

const factoryAbi = parseAbi(['function proxyCreationCode() view returns (bytes)']);
const versions = ['1.3.0', '1.4.1'];
/** Verify both proxy runtime and singleton against pinned published deployments.
 * A contract that merely returns getOwners/getThreshold is not a Safe. */
export async function assertSafeIdentity(client: ReturnType<typeof getChainClient>, address: Address, chainId: number, blockNumber: bigint) {
  const [code, slot] = await Promise.all([
    client.getCode({ address, blockNumber }),
    client.getStorageAt({ address, slot: '0x0', blockNumber }),
  ]);
  if (!code || code === '0x') throw new Error('No deployed Safe was found at this address on this network');
  if (!slot || slot.length !== 66) throw new Error('Could not verify the funding account implementation');
  const singleton = `0x${slot.slice(-40)}` as Address;
  const singletonCode = await client.getCode({ address: singleton, blockNumber });
  const published = versions.flatMap(version => [getSafeSingletonDeployments({ network: String(chainId), version }), getSafeL2SingletonDeployments({ network: String(chainId), version })]).filter(d => !!d);
  const supported = published.filter(d => {
    const addresses = d.networkAddresses[String(chainId)];
    const allowed = Array.isArray(addresses) ? addresses : [addresses];
    return allowed.some(a => a?.toLowerCase() === singleton.toLowerCase()) && Object.values(d.deployments).some(p => p?.address.toLowerCase() === singleton.toLowerCase() && singletonCode && p.codeHash === keccak256(singletonCode));
  });
  if (!supported.length) throw new Error('This account does not use a supported, verified Safe implementation');
  // A factory's creation code returns the exact proxy runtime when evaluated as
  // an eth_call contract creation. No transaction is signed or broadcast.
  for (const version of versions) {
    const factory = getProxyFactoryDeployments({ network: String(chainId), version });
    if (!factory) continue;
    const network = factory.networkAddresses[String(chainId)];
    for (const factoryAddress of Array.isArray(network) ? network : [network]) {
      if (!factoryAddress) continue;
      const deployment = Object.values(factory.deployments).find(d => d?.address.toLowerCase() === factoryAddress.toLowerCase());
      const factoryCode = await client.getCode({ address: factoryAddress as Address, blockNumber });
      if (!deployment || !factoryCode || keccak256(factoryCode) !== deployment.codeHash) continue;
      const creation = await client.readContract({ address: factoryAddress as Address, abi: factoryAbi, functionName: 'proxyCreationCode', blockNumber });
      const runtime = await client.call({ data: concatHex([creation, encodeAbiParameters([{ type: 'address' }], [singleton])]), blockNumber });
      if (runtime.data && keccak256(runtime.data) === keccak256(code)) return;
    }
  }
  throw new Error('This account proxy could not be verified against supported Safe deployments');
}
