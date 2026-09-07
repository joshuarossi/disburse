import { getCompatibilityFallbackHandlerDeployments } from '@safe-global/safe-deployments';
import { keccak256, parseAbi, stringToHex, type Address } from 'viem';
import { assertSafeIdentity } from './safeIdentity';
import { getChainClient } from './safeVerification';
import { supportedSafe4337Handler } from '../../shared/safe4337';

export const authorityAbi = parseAbi([
  'function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)', 'function nonce() view returns (uint256)',
  'function checkNSignatures(bytes32 dataHash,bytes data,bytes signatures,uint256 requiredSignatures) view',
]);
const handlerSlot = keccak256(stringToHex('fallback_manager.handler.address'));
export type AuthorityNode = { address: string; owners: string[]; threshold: number; nonce: number; contracts: string[] };
export type AccountAuthority = { root: string; blockNumber: string; nodes: AuthorityNode[] };
export async function assertSignatureHandler(client: ReturnType<typeof getChainClient>, address: Address, chainId: number, blockNumber: bigint) {
  const slot = await client.getStorageAt({ address, slot: handlerSlot, blockNumber });
  if (!slot || slot.length !== 66) throw new Error('Could not verify the owning account signature handler');
  const handler = `0x${slot.slice(-40)}` as Address;
  const code = await client.getCode({ address: handler, blockNumber });
  if (supportedSafe4337Handler(chainId, handler, code)) return;
  const deployments = ['1.3.0', '1.4.1'].map(version => getCompatibilityFallbackHandlerDeployments({ version, network: String(chainId) })).filter(d => !!d);
  if (!code || !deployments.some(d => {
    const network = d.networkAddresses[String(chainId)];
    return (Array.isArray(network) ? network : [network]).some(a => a?.toLowerCase() === handler.toLowerCase()) && Object.values(d.deployments).some(p => p?.address.toLowerCase() === handler.toLowerCase() && p.codeHash === keccak256(code));
  })) throw new Error('This owning account needs a supported Safe signature handler');
}

/** One checkpoint, bounded traversal. Unknown contract owners never become human owners. */
export async function readAccountAuthority(chainId: number, root: string, atBlock?: bigint): Promise<AccountAuthority> {
  const client = getChainClient(chainId);
  if (await client.getChainId() !== chainId) throw new Error('The account reader returned another network');
  const blockNumber = atBlock ?? await client.getBlockNumber();
  const nodes = new Map<string, AuthorityNode>();
  const visit = async (raw: string, ancestors: string[]) => {
    const address = raw.toLowerCase() as Address;
    if (ancestors.includes(address)) throw new Error('The account approval hierarchy contains a cycle');
    if (ancestors.length > 3) throw new Error('Account approvals support at most three levels of owning accounts');
    if (nodes.has(address)) return;
    if (nodes.size >= 32) throw new Error('The account approval hierarchy exceeds 32 accounts');
    await assertSafeIdentity(client, address, chainId, blockNumber);
    if (ancestors.length) await assertSignatureHandler(client, address, chainId, blockNumber);
    const [owners, threshold, nonce] = await Promise.all([
      client.readContract({ address, abi: authorityAbi, functionName: 'getOwners', blockNumber }),
      client.readContract({ address, abi: authorityAbi, functionName: 'getThreshold', blockNumber }),
      client.readContract({ address, abi: authorityAbi, functionName: 'nonce', blockNumber }),
    ]);
    if (owners.length > 50 || threshold < 1n || threshold > BigInt(owners.length) || nonce > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsupported account approval policy');
    const node: AuthorityNode = { address, owners: owners.map(o => o.toLowerCase()), threshold: Number(threshold), nonce: Number(nonce), contracts: [] };
    nodes.set(address, node);
    const codes = await Promise.all(owners.map(owner => client.getCode({ address: owner, blockNumber })));
    for (let i = 0; i < owners.length; i++) {
      if (!codes[i] || codes[i] === '0x') continue;
      node.contracts.push(owners[i].toLowerCase());
      await visit(owners[i], [...ancestors, address]);
    }
  };
  await visit(root, []);
  return { root: root.toLowerCase(), blockNumber: blockNumber.toString(), nodes: [...nodes.values()] };
}
export function approvalPaths(authority: AccountAuthority, wallet: string): string[][] {
  const paths: string[][] = [];
  let visits = 0;
  const visit = (address: string, path: string[]) => {
    if (++visits > 128 || path.includes(address) || path.length > 3 || paths.length > 64) throw new Error('Unsupported account approval hierarchy');
    const node = authority.nodes.find(n => n.address === address);
    if (!node) throw new Error('An owning account could not be verified');
    const next = [...path, address];
    if (node.owners.includes(wallet.toLowerCase()) && !node.contracts.includes(wallet.toLowerCase())) paths.push(next);
    for (const child of node.contracts) visit(child, next);
  };
  visit(authority.root, []);
  return paths;
}

export function availableAccountApprovals(authority: AccountAuthority, wallets: string[]) {
  const approved = new Set(wallets.map(w => w.toLowerCase()));
  let visits = 0;
  const visit = (address: string, depth: number): boolean => {
    if (++visits > 128 || depth > 3) throw new Error('Unsupported account approval hierarchy');
    const node = authority.nodes.find(n => n.address === address)!;
    return node.owners.filter(owner => node.contracts.includes(owner) ? visit(owner, depth + 1) : approved.has(owner)).length >= node.threshold;
  };
  return visit(authority.root, 0);
}
