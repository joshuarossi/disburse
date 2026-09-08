/** Bound the body while reading it. Checking response.text().length afterwards
 * still lets a faulty endpoint fill the browser's memory or never finish. */
export async function readServiceJson(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (!response.body || (length && /^\d+$/.test(length) && BigInt(length) > BigInt(limit))) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Invalid service response');
  }
  const reader = response.body.getReader();
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => {
      void reader.cancel().catch(() => {});
      reject(new Error('Service response interrupted'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    signal.throwIfAborted();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0, text = '';
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Service response too large');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
