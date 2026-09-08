import { beforeEach, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { padHex } from 'viem';
import { approvalPaths, readAccountAuthority, readProspectiveAccountAuthority } from '../lib/accountAuthority';
import { prepareAccountTransaction, verifyAccountSignature } from '../lib/accountApproval';
import { approvalSigningData } from '../../shared/safeSignatures';
import { SAFE_4337_MODULE } from '../../shared/safe4337';
import runtime from '../../src/lib/__tests__/fixtures/safe4337Runtime.json';

const rpc = vi.hoisted(() => ({ getChainId: vi.fn(), getBlockNumber: vi.fn(), getCode: vi.fn(), getStorageAt: vi.fn(), readContract: vi.fn() }));
const identity = vi.hoisted(() => vi.fn());
vi.mock('../lib/safeVerification', () => ({ getChainClient: () => rpc }));
vi.mock('../lib/safeIdentity', () => ({ assertSafeIdentity: identity }));
const root = '0x1111111111111111111111111111111111111111';
const parent = '0x2222222222222222222222222222222222222222';
const delegation = '0xef01003333333333333333333333333333333333333333';
const signer = privateKeyToAccount(generatePrivateKey());
let code: string | undefined, nested = false;
beforeEach(() => {
  vi.resetAllMocks(); code = delegation; nested = false;
  rpc.getChainId.mockResolvedValue(84532); rpc.getBlockNumber.mockResolvedValue(100n);
  rpc.getCode.mockImplementation(async ({ address }) => address.toLowerCase() === signer.address.toLowerCase() ? code : address.toLowerCase() === SAFE_4337_MODULE.toLowerCase() ? runtime.bytecode : '0x6000');
  rpc.getStorageAt.mockResolvedValue(padHex(SAFE_4337_MODULE, { size: 32 }));
  rpc.readContract.mockImplementation(async ({ address, functionName }) => functionName === 'getOwners' ? [nested && address === root ? parent : signer.address] : functionName === 'getThreshold' ? 1n : 0n);
  identity.mockImplementation(async (_, address) => { if (![root, parent].includes(address)) throw new Error('Unsupported account contract'); });
});

it.each([undefined, '0x', delegation])('preserves ECDSA approvals for a key-controlled owner with code %s', async walletCode => {
  code = walletCode;
  const authority = await readAccountAuthority(84532, root);
  expect(authority.nodes).toHaveLength(1);
  expect(authority.nodes[0].contracts).toEqual([]);
  expect(approvalPaths(authority, signer.address)).toEqual([[root]]);
  const tx = prepareAccountTransaction({ chainId: 84532, token: 'USDC', recipients: [{ recipientAddress: parent, amount: '1' }] }, 0);
  const digest = approvalSigningData(84532, [root], tx).hash;
  const signature = await signer.sign({ hash: digest });
  await expect(verifyAccountSignature(84532, authority, { safeAddress: root, safeTxHash: digest, safeTransactionData: tx, senderAddress: signer.address, senderSignature: signature }, { path: [root], owner: signer.address, signature })).resolves.toBe(digest);
  await expect(verifyAccountSignature(84532, authority, { safeAddress: root, safeTxHash: digest, safeTransactionData: tx, senderAddress: signer.address, senderSignature: signature }, { path: [root], owner: parent, signature })).rejects.toThrow('approval path');
});

it('finds an upgraded key signer through an owning Safe with the verified 4337 handler', async () => {
  nested = true;
  const authority = await readAccountAuthority(84532, root);
  expect(authority.nodes).toHaveLength(2);
  expect(approvalPaths(authority, signer.address)).toEqual([[root, parent]]);
  expect(identity.mock.calls.map(call => call[1])).toEqual([root, parent]);
});

it.each(['0x6000', '0xef0100', `${delegation}00`, `0xef0100${'0'.repeat(40)}`])('never converts an unknown contract or malformed delegation into a key signer: %s', async walletCode => {
  code = walletCode;
  await expect(readAccountAuthority(84532, root)).rejects.toThrow('Unsupported account contract');
});

it('checks a new account owner without requiring the new account to exist yet', async () => {
  const authority = await readProspectiveAccountAuthority(84532, root, [signer.address], 1);
  expect(identity).not.toHaveBeenCalled();
  expect(approvalPaths(authority, signer.address)).toEqual([[root]]);
});
it('verifies the contract and signature handler of a proposed owning Safe', async () => {
  const authority = await readProspectiveAccountAuthority(84532, root, [parent], 1);
  expect(identity.mock.calls.map(call => call[1])).toEqual([parent]);
  expect(rpc.getStorageAt).toHaveBeenCalled();
  expect(approvalPaths(authority, signer.address)).toEqual([[root, parent]]);
  rpc.getStorageAt.mockResolvedValue(padHex(root, { size: 32 }));
  await expect(readProspectiveAccountAuthority(84532, root, [parent], 1)).rejects.toThrow('signature handler');
});
it('refuses an unsupported proposed contract owner before an account deposit', async () => {
  code = '0x6000';
  await expect(readProspectiveAccountAuthority(84532, root, [signer.address], 1)).rejects.toThrow('Unsupported account contract');
});
it('refuses a proposed owner hierarchy that loops back to the new account', async () => {
  rpc.readContract.mockImplementation(async ({ functionName }) => functionName === 'getOwners' ? [root] : functionName === 'getThreshold' ? 1n : 0n);
  await expect(readProspectiveAccountAuthority(84532, root, [parent], 1)).rejects.toThrow('cycle');
});
