/** Providers wrap EIP-1193 errors differently. Only explicit rejection codes
 * prove a wallet declined a send; message matching must never unlock a retry. */
function errorChain(error: unknown): Record<string, unknown>[] {
  const pending = [error];
  const seen = new Set<object>();
  const errors: Record<string, unknown>[] = [];
  while (pending.length && errors.length < 32) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const node = current as Record<string, unknown>;
    errors.push(node);
    for (const key of ['cause', 'error', 'originalError', 'data']) {
      if (node[key] && typeof node[key] === 'object') pending.push(node[key]);
    }
  }
  return errors;
}

export function walletDeclined(error: unknown): boolean {
  return errorChain(error).some(({ code }) =>
    code === 4001 || code === '4001' || code === 'ACTION_REJECTED',
  );
}

export const WALLET_CANCELLED_MESSAGE =
  'Wallet confirmation cancelled. You can try again when you are ready.';

/** Keep useful app validation messages, but never render RPC request arguments,
 * calldata, stack traces or SDK diagnostics as product copy. Submission recovery
 * belongs to the caller, which knows whether a transaction might have been sent. */
export function walletErrorMessage(error: unknown, fallback: string): string {
  if (walletDeclined(error)) return WALLET_CANCELLED_MESSAGE;
  const errors = errorChain(error);
  if (errors.some(({ code }) => code === -32002 || code === '-32002'))
    return 'A confirmation is already open in your wallet. Open your wallet to approve or cancel it.';
  if (errors.some(({ code }) => [4900, 4901, '4900', '4901'].includes(code as number | string)))
    return 'Your wallet is disconnected from this network. Reconnect it and try again.';
  if (errors.some(({ name }) => name === 'InsufficientFundsError'))
    return 'There are not enough funds to cover this transaction and its network fee. Check your balance and try again.';

  const first = errors[0];
  const raw = first?.shortMessage ?? first?.message ?? error;
  if (typeof raw !== 'string') return fallback;
  const message = raw.trim();
  if (!message || message.length > 240 || /[\r\n]|0x[\da-f]{40,}|https?:\/\/|\b(?:Request Arguments|Raw Call Arguments|Details:|Version:|Stack:|execution reverted\b|JSON-RPC\b|Internal RPC\b|HttpRequestError\b)/i.test(message))
    return fallback;
  return message;
}
