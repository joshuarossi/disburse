import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeAbiParameters, decodeFunctionData, hashDomain, parseAbi, type Address, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { GetQuotePayload } from '@biconomy/abstractjs';
import fixture from './fixtures/customerQuote.json';
import { authorizeCustomerExecution } from '../services/permitAuthorization';
import type { CustomerExecutionIntent } from '../../../shared/customerPaidExecution';

// Public Anvil fixture key; never use this address for real funds.
const signer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const other = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const quote = fixture as unknown as GetQuotePayload;
const decoded = decodeFunctionData({ abi: parseAbi(['function execute(bytes32 mode, bytes executionCalldata)']), data: quote.userOps[1].userOp.callData });
const calls = decodeAbiParameters([{ type: 'tuple[]', components: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }], decoded.args[1])[0];
const intent: CustomerExecutionIntent = { chainId: 84532, owner: signer.address, companion: quote.paymentInfo.sender, token: quote.paymentInfo.token, amount: 1_000_000n, calls: calls.slice(1), initCode: quote.paymentInfo.initCode, validAfter: 1788797030, validUntil: 1788797630 };
const domain = { name: 'USDC', version: '2', chainId: intent.chainId, verifyingContract: intent.token };
const separator = hashDomain({ domain: { ...domain, chainId: BigInt(domain.chainId) }, types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] } });
function clients() {
  const getAddresses = vi.fn(async (): Promise<Address[]> => [signer.address]);
  const getChainId = vi.fn(async () => intent.chainId);
  const signTypedData = vi.fn(async (args: Parameters<typeof signer.signTypedData>[0]) => signer.signTypedData(args));
  const values: Record<string, unknown> = { balanceOf: 10_000_000n, nonces: 4n, name: 'USDC', version: '2', DOMAIN_SEPARATOR: separator };
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]);
  return { values, getAddresses, getChainId, signTypedData, readContract, wallet: { getAddresses, getChainId, signTypedData } as unknown as WalletClient, reader: { readContract, getChainId: vi.fn(async () => intent.chainId) } as unknown as PublicClient };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1788797050_000); });
afterEach(() => { vi.useRealTimers(); });

describe('wallet USDC authorization', () => {
  it('signs only the exact verified debit, current permit nonce and committed operations', async () => {
    const c = clients();
    const result = await authorizeCustomerExecution({ quote, intent }, c.wallet, c.reader);
    expect(c.signTypedData).toHaveBeenCalledOnce();
    expect(c.signTypedData.mock.calls[0][0]).toMatchObject({ domain, primaryType: 'Permit', message: { owner: signer.address, spender: intent.companion, value: 1_023_122n, nonce: 4n, deadline: BigInt(quote.hash) } });
    expect(result.hash).toBe(quote.hash);
    expect(result.signature.startsWith('0x177eee02')).toBe(true);
    // No transaction-sending method exists on this wallet or RPC fixture.
  });
  it.each(['balance', 'network', 'account', 'disconnected', 'permit domain'])('stops before signing when %s changes', async kind => {
    const c = clients();
    if (kind === 'balance') c.values.balanceOf = 1n;
    if (kind === 'network') c.getChainId.mockResolvedValue(1);
    if (kind === 'account') c.getAddresses.mockResolvedValue([other.address]);
    if (kind === 'disconnected') c.getAddresses.mockResolvedValue([]);
    if (kind === 'permit domain') c.values.DOMAIN_SEPARATOR = `0x${'00'.repeat(32)}`;
    await expect(authorizeCustomerExecution({ quote, intent }, c.wallet, c.reader)).rejects.toThrow();
    expect(c.signTypedData).not.toHaveBeenCalled();
  });
  it('preserves wallet cancellation for the neutral cancellation notice', async () => {
    const c = clients(), rejection = Object.assign(new Error('User rejected'), { code: 4001 });
    c.signTypedData.mockRejectedValue(rejection);
    await expect(authorizeCustomerExecution({ quote, intent }, c.wallet, c.reader)).rejects.toBe(rejection);
  });
  it('refuses a signature from a different wallet', async () => {
    const c = clients(); c.signTypedData.mockImplementation(args => other.signTypedData(args));
    await expect(authorizeCustomerExecution({ quote, intent }, c.wallet, c.reader)).rejects.toThrow('signature does not match');
  });
  it.each(['network', 'account'])('refuses a %s change during the wallet prompt', async kind => {
    const c = clients();
    if (kind === 'network') c.getChainId.mockResolvedValueOnce(intent.chainId).mockResolvedValue(1);
    else c.getAddresses.mockResolvedValueOnce([signer.address]).mockResolvedValue([other.address]);
    await expect(authorizeCustomerExecution({ quote, intent }, c.wallet, c.reader)).rejects.toThrow('changed during approval');
  });
  it('does not return a signed payload if the quote expires in the wallet', async () => {
    const c = clients(); c.signTypedData.mockImplementation(async args => { vi.setSystemTime(1788797400_000); return signer.signTypedData(args); });
    await expect(authorizeCustomerExecution({ quote, intent }, c.wallet, c.reader)).rejects.toThrow('expired');
  });
  it('does not open the wallet if token reads fail', async () => {
    const c = clients(); c.readContract.mockRejectedValue(new Error('Network unavailable'));
    await expect(authorizeCustomerExecution({ quote, intent }, c.wallet, c.reader)).rejects.toThrow('Network unavailable');
    expect(c.signTypedData).not.toHaveBeenCalled();
  });
  it('does not release a signed payload after another USDC permit consumes the nonce', async () => {
    const c = clients();
    c.signTypedData.mockImplementation(async args => { c.values.nonces = 5n; return signer.signTypedData(args); });
    await expect(authorizeCustomerExecution({ quote, intent }, c.wallet, c.reader)).rejects.toThrow('authorization changed');
    expect(c.signTypedData).toHaveBeenCalledOnce();
  });
  it('rejects an RPC endpoint connected to another chain before signing', async () => {
    const c = clients(); vi.mocked(c.reader.getChainId).mockResolvedValue(1);
    await expect(authorizeCustomerExecution({ quote, intent }, c.wallet, c.reader)).rejects.toThrow('reader returned a different network');
    expect(c.signTypedData).not.toHaveBeenCalled();
  });
});
