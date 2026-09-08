import { BaseError, UserRejectedRequestError } from 'viem';
import { CHAIN_TOKENS } from '../../../shared/chains';
import { ServiceExecutionError, CUSTOMER_EXECUTION_CHAINS } from '../../../shared/customerPaidExecution';
import type { CustomerServiceQuote } from '@/lib/services/customerExecution';

const scenario = () => sessionStorage.getItem('qa:scenario') ?? '';
function requireScenario() { if (!scenario().startsWith('customer-setup-')) throw new Error('Account setup is disabled in visual QA.'); }
export function serviceChain(chainId: number) {
  requireScenario();
  if (!CUSTOMER_EXECUTION_CHAINS.includes(chainId as typeof CUSTOMER_EXECUTION_CHAINS[number])) throw new ServiceExecutionError('unsupported', 'Fees in USDC are not available on this network. Choose a supported network.');
  return { id: chainId };
}
export function serviceReader() { return { getCode: async () => undefined }; }
export async function quoteCustomerExecution(input: CustomerServiceQuote['intent']) {
  requireScenario();
  sessionStorage.setItem('qa:quoteAttempts', String(Number(sessionStorage.getItem('qa:quoteAttempts') ?? 0) + 1));
  if (scenario().endsWith('insufficient')) throw new ServiceExecutionError('balance', 'Your wallet does not have enough USDC for the deposit and quoted fee. Add USDC or lower the deposit amount.');
  if (scenario().endsWith('unavailable')) throw new ServiceExecutionError('unavailable', 'The execution service is busy. Wait a moment and try again.');
  if (scenario().endsWith('malformed')) throw new ServiceExecutionError('invalid_quote', 'The execution service returned a quote that does not match your instructions. Nothing was sent. Request a new quote.');
  const now = Math.floor(Date.now() / 1000);
  const fee = 25_000n;
  return { intent: { ...input, token: CHAIN_TOKENS[8453].USDC.address, companion: '0x3333333333333333333333333333333333333333', initCode: '0x', validAfter: now, validUntil: now + 600 },
    quote: { hash: `0x${'ab'.repeat(32)}` }, fee, debit: input.amount + fee, balance: 20_000_000n, startBlock: 1000n, expiresAt: Date.now() + (scenario().endsWith('expired-quote') ? 31_000 : 300_000),
  } as unknown as CustomerServiceQuote;
}
export async function signCustomerExecution(prepared: CustomerServiceQuote) {
  requireScenario();
  sessionStorage.setItem('qa:walletAttempts', String(Number(sessionStorage.getItem('qa:walletAttempts') ?? 0) + 1));
  if (scenario().endsWith('declined')) throw new BaseError('User rejected the request.', { cause: new UserRejectedRequestError(new Error('User denied transaction signature.')), metaMessages: [`Request Arguments: data: 0x${'00'.repeat(2000)}`] });
  if (scenario().endsWith('wallet-changed')) throw new ServiceExecutionError('wallet_changed', 'Your connected wallet changed. Switch back to the wallet used for this quote.');
  return { ...prepared.quote, signature: '0x1234' };
}
export async function serviceRequest() {
  requireScenario();
  sessionStorage.setItem('qa:submissions', String(Number(sessionStorage.getItem('qa:submissions') ?? 0) + 1));
  if (scenario().endsWith('unknown')) throw new Error('RPC response lost');
  return { hash: `0x${'ab'.repeat(32)}` };
}
