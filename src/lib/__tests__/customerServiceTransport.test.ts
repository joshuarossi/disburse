import { afterEach, expect, it, vi } from 'vitest';
import { serviceRequest, serviceChain } from '../services/customerExecution';
import { CUSTOMER_EXECUTION_URL } from '../../../shared/customerPaidExecution';

afterEach(() => vi.unstubAllGlobals());
it('submits exactly once to the published endpoint with no operator credentials or automatic retry', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ hash: `0x${'ab'.repeat(32)}` })));
  vi.stubGlobal('fetch', request);
  await serviceRequest('exec', { signature: 'test-signature', fee: 25_000n });
  expect(request).toHaveBeenCalledTimes(1);
  const [url, options] = request.mock.calls[0];
  expect(url).toBe(`${CUSTOMER_EXECUTION_URL}/exec`);
  expect(options).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(options.headers.Authorization).toBeUndefined();
  expect(JSON.parse(options.body)).toEqual({ signature: 'test-signature', fee: '25000' });
});
it.each([401, 403, 429, 500, 503])('returns bounded product copy for HTTP %s and never retries a send', async status => {
  const request = vi.fn().mockResolvedValue(new Response('Internal RPC request: 0xdeadbeef\nAPI key diagnostic', { status }));
  vi.stubGlobal('fetch', request);
  await expect(serviceRequest('exec', { signature: 'signed' })).rejects.toThrow(status === 429 ? 'service is busy' : 'could not complete');
  expect(request).toHaveBeenCalledTimes(1);
});
it.each(['<html>gateway failed</html>', 'x'.repeat(262_145)])('rejects non-JSON and oversized responses', async body => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  await expect(serviceRequest('quote-permit', { quote: 'test' })).rejects.toThrow('unreadable');
});
it.each([new TypeError('Failed to fetch'), new DOMException('timeout', 'TimeoutError')])('treats interrupted submissions as ambiguous and makes no second request', async error => {
  const request = vi.fn().mockRejectedValue(error); vi.stubGlobal('fetch', request);
  await expect(serviceRequest('exec', { signature: 'signed' })).rejects.toThrow('could not be reached');
  expect(request).toHaveBeenCalledTimes(1);
});
it('refuses arbitrary service paths and unsupported networks', async () => {
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  for (const path of ['../sponsor', 'quote', 'fund', 'exec?apiKey=other', 'https://other.example']) await expect(serviceRequest(path, {})).rejects.toThrow('Unsupported service request');
  for (const chainId of [11155111, 0, NaN, 999999]) expect(() => serviceChain(chainId)).toThrow('not available');
  expect(request).not.toHaveBeenCalled();
});
