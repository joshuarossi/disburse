import { createPublicClient, createWalletClient, custom, http, concatHex, erc20Abi, type Address, type Hex } from 'viem';
import { getMEEVersion, getDefaultMEENetworkApiKey, MEEVersion, toMultichainNexusAccount, getMockSafeSigner, getPermitQuote, type GetQuotePayload } from '@biconomy/abstractjs';
import { CUSTOMER_EXECUTION_CHAINS, CUSTOMER_EXECUTION_URL, ServiceExecutionError, verifyCustomerQuote, type CustomerExecutionIntent, type ServiceCall } from '../../../shared/customerPaidExecution';
import { CHAIN_TOKENS, CHAIN_ID_TO_CHAIN, getPublicRpcUrl, type SupportedChainId } from '../chains';
import { getConnectedProvider } from '../walletProvider';
import { authorizeCustomerExecution } from './permitAuthorization';
import { readServiceJson } from '../../../shared/serviceResponse';

/** Permissionless customer-paid requests only. The SDK's published public key only; no Disburse account, gas tank, sponsorship,
 * default fee payer, fallback transaction, or automatic submission retry. */
export async function serviceRequest(path: string, body?: unknown): Promise<unknown> {
  if (!/^(info|quote-permit|exec|explorer\/0x[\da-f]{64})$/i.test(path)) throw new Error('Unsupported service request');
  const encoded = body ? JSON.stringify(body, (_, v) => typeof v === 'bigint' ? v.toString() : v) : undefined;
  if (encoded && new TextEncoder().encode(encoded).byteLength > 262_144) throw new Error('This account setup request is too large. Review its account settings.');
  const signal = AbortSignal.timeout(20_000);
  let response: Response;
  try {
    response = await fetch(`${CUSTOMER_EXECUTION_URL}/${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-api-key': getDefaultMEENetworkApiKey(false) }, ...(body ? { body: encoded } : {}), signal, credentials: 'omit', redirect: 'error' });
  } catch {
    throw new ServiceExecutionError('unavailable', 'The execution service could not be reached. Your details are saved. Try again shortly.');
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new ServiceExecutionError('unavailable', response.status === 429 ? 'The execution service is busy. Wait a moment and try again.' : 'The execution service could not complete this request. Try again shortly.');
  }
  try {
    return await readServiceJson(response, 262_144, signal);
  } catch { throw new ServiceExecutionError('unavailable', 'The execution service returned an unreadable response. Try again shortly.'); }
}

export type CustomerServiceQuote = {
  intent: CustomerExecutionIntent; quote: GetQuotePayload; fee: bigint; debit: bigint; expiresAt: number; balance: bigint; startBlock: bigint;
};
export function serviceChain(chainId: number) {
  if (!CUSTOMER_EXECUTION_CHAINS.includes(chainId as typeof CUSTOMER_EXECUTION_CHAINS[number])) throw new ServiceExecutionError('unsupported', 'Fees in USDC are not available on this network. Choose a supported network.');
  return CHAIN_ID_TO_CHAIN[chainId as SupportedChainId];
}
export function serviceReader(chainId: number) {
  return createPublicClient({ chain: serviceChain(chainId), transport: http(getPublicRpcUrl(chainId), { timeout: 15_000, retryCount: 0, batch: true }) });
}

export async function quoteCustomerExecution(input: { chainId: number; owner: Address; amount: bigint; calls: ServiceCall[] }): Promise<CustomerServiceQuote> {
  const chain = serviceChain(input.chainId), token = CHAIN_TOKENS[input.chainId as SupportedChainId].USDC.address;
  const reader = serviceReader(input.chainId);
  const account = await toMultichainNexusAccount({ signer: getMockSafeSigner(input.owner), chainConfigurations: [{ chain, transport: http(getPublicRpcUrl(chain.id), { timeout: 15_000, retryCount: 0 }), version: getMEEVersion(MEEVersion.V2_2_3) }] });
  const deployment = account.deploymentOn(chain.id, true);
  const [factory, info, balance, startBlock, readerChainId] = await Promise.all([
    deployment.getFactoryArgs(), serviceRequest('info'), reader.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [input.owner] }), reader.getBlockNumber(), reader.getChainId(),
  ]);
  if (readerChainId !== input.chainId) throw new ServiceExecutionError('unavailable', 'The network reader returned a different network. Try again shortly.');
  if (balance <= input.amount) throw new ServiceExecutionError('balance', 'Your wallet needs enough USDC for the deposit and the setup fee. Add USDC or lower the deposit amount.');
  const initCode = factory.factory && factory.factoryData ? concatHex([factory.factory, factory.factoryData]) : '0x';
  const now = Math.floor(Date.now() / 1000);
  const intent: CustomerExecutionIntent = { ...input, token, companion: account.addressOn(chain.id, true), initCode, validAfter: now, validUntil: now + 600 };
  // getPermitQuote only needs these three client members. It cannot sign or send.
  const client = { account, info, request: ({ path, body }: { path: string; body?: unknown }) => serviceRequest(path, body) } as Parameters<typeof getPermitQuote>[0];
  const result = await getPermitQuote(client, { trigger: { chainId: chain.id, tokenAddress: token, amount: input.amount }, feeToken: { address: token, chainId: chain.id, gasRefundAddress: input.owner }, instructions: [{ chainId: chain.id, calls: input.calls.map(call => ({ ...call, gasLimit: 600_000n })) }], lowerBoundTimestamp: intent.validAfter, upperBoundTimestamp: intent.validUntil, simulation: { simulate: true } });
  const verified = verifyCustomerQuote(result.quote, intent);
  if (verified.debit > balance) throw new ServiceExecutionError('balance', 'Your wallet does not have enough USDC for the deposit and quoted fee. Add USDC or lower the deposit amount.');
  return { ...verified, intent, balance, startBlock };
}

/** Request a wallet signature only. The external provider handles submission. */
export async function signCustomerExecution(prepared: CustomerServiceQuote): Promise<GetQuotePayload & { signature: Hex }> {
  const provider = await getConnectedProvider(prepared.intent.chainId);
  const wallet = createWalletClient({ account: prepared.intent.owner, chain: serviceChain(prepared.intent.chainId), transport: custom(provider, { retryCount: 0 }) });
  return authorizeCustomerExecution(prepared, wallet, serviceReader(prepared.intent.chainId));
}
