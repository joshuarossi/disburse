import { beforeEach, expect, it, vi } from 'vitest';
import { keccak256, padHex } from 'viem';
import { approvalPaths, availableAccountApprovals, readAccountAuthority } from '../accountAuthority';
const root = '0x1111111111111111111111111111111111111111', parent = '0x2222222222222222222222222222222222222222', human = '0x3333333333333333333333333333333333333333', second = '0x4444444444444444444444444444444444444444', handler = '0x5555555555555555555555555555555555555555';
const state = vi.hoisted(() => ({ nodes: {} as Record<string, { owners: string[]; threshold: bigint }>, chainId: 1, handlerCode: '0x1234', reads: [] as any[] }));
vi.mock('../safeIdentity', () => ({ assertSafeIdentity: async (_client: unknown, address: string) => { if (!state.nodes[address]) throw new Error('Unsupported Safe identity'); } }));
vi.mock('@safe-global/safe-deployments', () => ({ getCompatibilityFallbackHandlerDeployments: () => ({ networkAddresses: { '1': handler }, deployments: { canonical: { address: handler, codeHash: keccak256('0x1234') } } }) }));
vi.mock('../safeVerification', () => ({ getChainClient: () => ({
  getChainId: async () => state.chainId, getBlockNumber: async () => 99n,
  getCode: async (args: any) => { state.reads.push(args); return args.address === handler ? state.handlerCode : state.nodes[args.address] ? '0xaa' : undefined; },
  getStorageAt: async (args: any) => { state.reads.push(args); return padHex(handler, { size: 32 }); },
  readContract: async (args: any) => { state.reads.push(args); const n = state.nodes[args.address]; return args.functionName === 'getOwners' ? n.owners : args.functionName === 'getThreshold' ? n.threshold : 42n; },
}) }));
beforeEach(() => { state.nodes = { [root]: { owners: [parent], threshold: 1n }, [parent]: { owners: [human, second], threshold: 2n } }; state.chainId = 1; state.handlerCode = '0x1234'; state.reads = []; });
it('discovers the actual threshold at one checkpoint and requires both parent owners for workspace readiness', async () => {
  const graph = await readAccountAuthority(1, root);
  expect(approvalPaths(graph, human)).toEqual([[root, parent]]);
  expect(availableAccountApprovals(graph, [human])).toBe(false);
  expect(availableAccountApprovals(graph, [human, second])).toBe(true);
  expect(graph.nodes[0].owners).toEqual([parent]);
  expect(state.reads.every(r => r.blockNumber === 99n)).toBe(true);
});
it('refuses cycles, excessive depth and excessive account counts', async () => {
  state.nodes[parent].owners = [root]; state.nodes[parent].threshold = 1n;
  await expect(readAccountAuthority(1, root)).rejects.toThrow('cycle');
  state.nodes = {};
  const accounts = Array.from({ length: 5 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
  accounts.forEach((a, i) => state.nodes[a] = { owners: [accounts[i + 1] ?? human], threshold: 1n });
  await expect(readAccountAuthority(1, accounts[0])).rejects.toThrow('three levels');
  state.nodes = { [root]: { owners: Array.from({ length: 33 }, (_, i) => `0x${(i + 20).toString(16).padStart(40, '0')}`), threshold: 1n } };
  state.nodes[root].owners.forEach(a => state.nodes[a] = { owners: [human], threshold: 1n });
  await expect(readAccountAuthority(1, root)).rejects.toThrow('32 accounts');
});
it('rejects the wrong network, altered fallback code and unverifiable contract owners', async () => {
  state.chainId = 11155111;
  await expect(readAccountAuthority(1, root)).rejects.toThrow('another network');
  state.chainId = 1; state.handlerCode = '0x4321';
  await expect(readAccountAuthority(1, root)).rejects.toThrow('signature handler');
});
it('does not infer that a parent is mandatory when direct owners can meet the paying account threshold', async () => {
  state.nodes[root].owners.push(human);
  const graph = await readAccountAuthority(1, root);
  expect(approvalPaths(graph, human)).toEqual([[root], [root, parent]]);
  expect(availableAccountApprovals(graph, [human])).toBe(true);
});
