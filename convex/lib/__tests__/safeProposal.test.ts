import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { assertSafeProposal, type SafeProposal } from '../safeProposal';
vi.mock('../safeIdentity', () => ({ assertSafeIdentity: vi.fn().mockResolvedValue(undefined) }));
const state = vi.hoisted(() => ({
  hash: '0x' + 'ab'.repeat(32),
  owner: '',
  threshold: 1n,
  nonce: 3n,
}));
vi.mock('../safeVerification', () => ({
  getChainClient: () => ({
    getBlockNumber: async () => 100n,
    readContract: async ({ functionName }: { functionName: string }) =>
      ({
        getOwners: [state.owner],
        getThreshold: state.threshold,
        nonce: state.nonce,
        getTransactionHash: state.hash,
      })[functionName],
  }),
}));
const owner = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
);
const safe = '0x3333333333333333333333333333333333333333';
const recipient = '0x2222222222222222222222222222222222222222';
const zero = '0x0000000000000000000000000000000000000000';
const expected = {
  chainId: 8453,
  safeAddress: safe,
  safeTxHash: state.hash,
  token: 'USDC',
  recipients: [{ recipientAddress: recipient, amount: '100' }],
};
async function proposal(): Promise<SafeProposal> {
  const signature = await owner.sign({ hash: state.hash as `0x${string}` });
  return {
    safe,
    to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    value: '0',
    operation: 0,
    data: encodeFunctionData({
      abi: parseAbi([
        'function transfer(address to,uint256 amount) returns (bool)',
      ]),
      functionName: 'transfer',
      args: [recipient, 100000000n],
    }),
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    gasToken: zero,
    nonce: 3,
    confirmations: [{ owner: owner.address, signature }],
  };
}
beforeEach(() => {
  state.owner = owner.address;
  state.threshold = 1n;
  state.nonce = 3n;
});
describe('server proposal verification', () => {
  it('verifies actual owner signatures and the current account nonce', async () => {
    await expect(
      assertSafeProposal(await proposal(), expected, true),
    ).resolves.toBeUndefined();
  });
  it('does not count a duplicate signature toward the threshold', async () => {
    state.threshold = 2n;
    const tx = await proposal();
    tx.confirmations!.push(tx.confirmations![0]);
    await expect(assertSafeProposal(tx, expected, true)).rejects.toThrow(
      'still needs',
    );
  });
  it('rejects a signature from a removed owner', async () => {
    const tx = await proposal();
    state.owner = recipient;
    await expect(assertSafeProposal(tx, expected, true)).rejects.toThrow(
      'needs owner signatures',
    );
  });
  it('rejects a substituted saved hash or fee currency', async () => {
    await expect(
      assertSafeProposal(
        await proposal(),
        { ...expected, safeTxHash: '0x' + 'cd'.repeat(32) },
        false,
      ),
    ).rejects.toThrow('transaction hash');
    await expect(
      assertSafeProposal(
        { ...(await proposal()), gasToken: recipient },
        expected,
        false,
      ),
    ).rejects.toThrow('fee currency');
  });
  it('blocks execution out of nonce order while still allowing a review', async () => {
    state.nonce = 2n;
    await expect(
      assertSafeProposal(await proposal(), expected, true),
    ).rejects.toThrow('Earlier account transactions');
    await expect(
      assertSafeProposal(await proposal(), expected, false),
    ).resolves.toBeUndefined();
  });
  it('accepts Safe eth_sign signatures with the adjusted recovery byte', async () => {
    const tx = await proposal();
    const signature = await owner.signMessage({
      message: { raw: state.hash as `0x${string}` },
    });
    tx.confirmations = [
      {
        owner: owner.address,
        signature:
          signature.slice(0, -2) +
          (Number.parseInt(signature.slice(-2), 16) + 4).toString(16),
      },
    ];
    await expect(
      assertSafeProposal(tx, expected, true),
    ).resolves.toBeUndefined();
  });
});

describe('approval progress', () => {
  it('ignores an authentic signature from a removed owner while retaining current approvals', async () => {
    const removed = privateKeyToAccount('0x0000000000000000000000000000000000000000000000000000000000000002');
    const tx = await proposal();
    tx.confirmations!.push({ owner: removed.address, signature: await removed.sign({ hash: state.hash as `0x${string}` }) });
    const { readOwnerApprovalStatus } = await import('../safeProposal');
    const status = await readOwnerApprovalStatus(tx, 8453, safe, state.hash as `0x${string}`);
    expect(status.confirmedOwners).toEqual([owner.address.toLowerCase()]);
    expect(status.ready).toBe(true);
  });
  it('returns verified partial approvals without claiming execution is ready', async () => {
    state.threshold = 2n;
    const { readOwnerApprovalStatus } = await import('../safeProposal');
    const status = await readOwnerApprovalStatus(await proposal(), 8453, safe, state.hash as `0x${string}`);
    expect(status.confirmedOwners).toEqual([owner.address.toLowerCase()]);
    expect(status.threshold).toBe(2);
    expect(status.ready).toBe(false);
  });
  it('does not present an out-of-order payment as ready even when fully signed', async () => {
    state.nonce = 2n;
    const { readOwnerApprovalStatus } = await import('../safeProposal');
    const status = await readOwnerApprovalStatus(await proposal(), 8453, safe, state.hash as `0x${string}`);
    expect(status.confirmedOwners).toHaveLength(1);
    expect(status.ready).toBe(false);
    expect(status.currentNonce).toBe(2);
  });
  it('rejects a service confirmation attributed to someone who did not sign', async () => {
    const { readOwnerApprovalStatus } = await import('../safeProposal');
    const tx = await proposal();
    tx.confirmations![0].owner = recipient;
    await expect(readOwnerApprovalStatus(tx, 8453, safe, state.hash as `0x${string}`)).rejects.toThrow('current account owner');
  });
});
