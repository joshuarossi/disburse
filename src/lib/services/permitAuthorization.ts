import { concatHex, encodeAbiParameters, erc20Abi, getAddress, keccak256, parseAbi, parseSignature, recoverTypedDataAddress, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import type { GetQuotePayload } from '@biconomy/abstractjs';
import { ServiceExecutionError, verifyCustomerQuote, type CustomerExecutionIntent } from '../../../shared/customerPaidExecution';

const permitAbi = parseAbi(['function nonces(address owner) view returns (uint256)', 'function DOMAIN_SEPARATOR() view returns (bytes32)', 'function name() view returns (string)', 'function version() view returns (string)']);
const permitTypes = { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] } as const;

/** Signs an exact USDC allowance. Never uses the SDK's on-chain approval fallback. */
export async function authorizeCustomerExecution(
  prepared: { intent: CustomerExecutionIntent; quote: GetQuotePayload },
  wallet: Pick<WalletClient, 'getAddresses' | 'getChainId' | 'signTypedData'>,
  reader: Pick<PublicClient, 'readContract' | 'getChainId'>,
): Promise<GetQuotePayload & { signature: Hex }> {
  const { intent } = prepared;
  const verified = verifyCustomerQuote(prepared.quote, intent);
  const [addresses, chainId, readerChainId, balance, nonce, name, version, separator] = await Promise.all([
    wallet.getAddresses(), wallet.getChainId(), reader.getChainId(),
    reader.readContract({ address: intent.token, abi: erc20Abi, functionName: 'balanceOf', args: [intent.owner] }),
    ...(['nonces', 'name', 'version', 'DOMAIN_SEPARATOR'] as const).map(functionName => reader.readContract({ address: intent.token, abi: permitAbi, functionName, ...(functionName === 'nonces' ? { args: [intent.owner] as [Address] } : {}) })),
  ]);
  if (readerChainId !== intent.chainId) throw new ServiceExecutionError('unavailable', 'The network reader returned a different network. Try again shortly.');
  if (chainId !== intent.chainId) throw new ServiceExecutionError('wallet_changed', 'Your wallet changed networks. Switch back to the network used for this quote.');
  if (addresses[0]?.toLowerCase() !== intent.owner.toLowerCase()) throw new ServiceExecutionError('wallet_changed', 'Your connected wallet changed. Switch back to the wallet used for this quote.');
  if (balance < verified.debit) throw new ServiceExecutionError('balance', 'Your USDC balance changed and no longer covers this quote. Add USDC or request a smaller deposit.');
  const domain = { name: String(name), version: String(version), chainId: intent.chainId, verifyingContract: getAddress(intent.token) };
  // Domain-only EIP-712 hash must match the token contract. Unknown permit formats stop here.
  const domainHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }], [keccak256(new TextEncoder().encode('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')), keccak256(new TextEncoder().encode(domain.name)), keccak256(new TextEncoder().encode(domain.version)), BigInt(intent.chainId), intent.token]));
  if (domainHash.toLowerCase() !== String(separator).toLowerCase()) throw new ServiceExecutionError('unsupported', 'This token does not support the required wallet authorization. No transaction was sent.');
  verifyCustomerQuote(prepared.quote, intent); // Reads and the wallet may take time.
  const authorization = { domain, types: permitTypes, primaryType: 'Permit' as const, message: { owner: intent.owner, spender: intent.companion, value: verified.debit, nonce: BigInt(nonce), deadline: BigInt(prepared.quote.hash) } };
  const signature = await wallet.signTypedData({ ...authorization, account: intent.owner });
  if ((await recoverTypedDataAddress({ ...authorization, signature })).toLowerCase() !== intent.owner.toLowerCase()) throw new ServiceExecutionError('wallet_changed', 'The wallet signature does not match the wallet used for this quote. Reconnect the original wallet and try again.');
  const [currentAddresses, currentChainId] = await Promise.all([wallet.getAddresses(), wallet.getChainId()]);
  if (currentAddresses[0]?.toLowerCase() !== intent.owner.toLowerCase() || currentChainId !== intent.chainId) throw new ServiceExecutionError('wallet_changed', 'Your wallet changed during approval. Reconnect the original wallet and network before trying again.');
  const currentNonce = await reader.readContract({ address: intent.token, abi: permitAbi, functionName: 'nonces', args: [intent.owner] });
  if (currentNonce !== BigInt(nonce)) throw new ServiceExecutionError('expired', 'Your USDC authorization changed during approval. Review a fresh quote before trying again.');
  verifyCustomerQuote(prepared.quote, intent); // Never submit a signature for a quote that expired in the wallet.
  const parts = parseSignature(signature);
  const encoded = encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }], [intent.token, intent.companion, separator as Hex, keccak256(new TextEncoder().encode('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')), verified.debit, BigInt(intent.chainId), BigInt(nonce), BigInt(parts.v ?? (27 + parts.yParity)), parts.r, parts.s]);
  return { ...prepared.quote, signature: concatHex(['0x177eee02', encoded]) };
}
