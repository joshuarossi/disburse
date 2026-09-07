/** Convert failures to product copy. This function never decides whether a
 * transaction was cancelled, sent, or safe to retry; the flow must know that. */
export function userErrorMessage(error: unknown, fallback: string): string {
  try {
    const node = error && typeof error === 'object' ? error as Record<string, unknown> : undefined;
    let candidate: unknown = node?.shortMessage ?? node?.message ?? error;
    if (node?.name === 'ConvexError') {
      const data = node.data;
      candidate = typeof data === 'string' ? data : data && typeof data === 'object' ? (data as Record<string, unknown>).message : candidate;
    }
    if (typeof candidate !== 'string') return fallback;
    // Convex adds request ids and a server stack to ordinary application errors.
    // Only unwrap its recognizable envelope; never print the stack or diagnostics.
    const plain = /^\[CONVEX [AMQ]\(/.test(candidate) ? candidate.match(/\bUncaught (?:Error|ConvexError): ([^\r\n]+)/)?.[1] ?? '' : candidate;
    const message = plain.trim();
    if (!message || message.length > 300 || /[\r\n]|0x[\da-f]{40,}|https?:\/\/|\b(?:Request Arguments|Raw Call Arguments|Details:|Version:|Stack:|Uncaught|Request ID:|execution reverted|JSON-RPC|Internal RPC|HttpRequestError|HTTP request failed|fetch failed|Failed to fetch|NetworkError|TypeError|SyntaxError|ECONNRESET|ETIMEDOUT|Cannot read properties)/i.test(message)) return fallback;
    return message;
  } catch { return fallback; }
}
