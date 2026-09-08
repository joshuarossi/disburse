import { afterEach, describe, expect, it, vi } from 'vitest';
import { circleRpc, CircleServiceError } from '../../../shared/circleTransport';

const request = () => circleRpc(84532, 'eth_sendUserOperation', [{ nonce: 7n }, '0xentrypoint']);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); });
describe('customer-paid public submission transport', () => {
  it('sends one credential-free request with canonical RPC quantities', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ jsonrpc: '2.0', id: 1, result: '0xhash' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await request()).toBe('0xhash');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.candide.dev/public/v3/84532');
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(options.body)).toEqual({ jsonrpc: '2.0', id: 1, method: 'eth_sendUserOperation', params: [{ nonce: '0x7' }, '0xentrypoint'] });
    expect(JSON.stringify(options)).not.toMatch(/api.?key|authorization|sponsor|gas.?tank/i);
  });
  it.each([400, 429, 500, 503])('does not retry a submission after HTTP %s', async status => {
    const fetcher = vi.fn().mockResolvedValue(reply({ diagnostic: 'private RPC details' }, status)); vi.stubGlobal('fetch', fetcher);
    await expect(request()).rejects.toMatchObject({ code: 'unavailable' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('does not retry an ambiguous connection failure or reveal diagnostics', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('https://provider.invalid/?secret=PRIVATE')); vi.stubGlobal('fetch', fetcher);
    await expect(request()).rejects.toMatchObject({ message: 'The execution service could not be reached. Check any pending request before trying again.' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([null, [], 'invalid', { jsonrpc: '2.0', id: 9, result: 'wrong request' }, { jsonrpc: '1.0', id: 1, result: 'wrong version' }, { jsonrpc: '2.0', id: 1 }, { jsonrpc: '2.0', id: 1, error: {}, result: 'contradictory' }])('rejects an invalid RPC envelope: %j', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
    await expect(request()).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('unreadable') });
  });
  it.each([null, [], 400, 'Request Arguments: private calldata', { message: 'AA31 paymaster deposit too low https://rpc.invalid?key=PRIVATE' }])('handles malformed provider errors without crashing or exposing them: %j', async error => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ jsonrpc: '2.0', id: 1, error })));
    await expect(request()).rejects.toMatchObject({ code: 'unavailable', message: 'The execution service could not accept this request. Check the account balance and fee authorization, then refresh its status.' });
  });
  it.each([['AA22 expired', 'expired'], ['AA32 expired', 'expired'], ['AA24 signature error', 'approval'], ['AA34 signature error', 'approval'], ['AA25 invalid account nonce', 'pending'], ['AA10 sender already constructed', 'pending']] as const)('maps %s to actionable recovery', async (message, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ jsonrpc: '2.0', id: 1, error: { code: -32500, message } })));
    await expect(request()).rejects.toMatchObject({ code });
  });
  it('keeps simulation failure separate from a submitted execution failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ jsonrpc: '2.0', id: 1, error: { code: -32521, message: 'Execution reverted: 0xacfdb444' } })));
    await expect(circleRpc(84532, 'eth_estimateUserOperationGas', [])).rejects.toMatchObject({ code: 'simulation' });
  });
  it('rejects unsupported networks without making a request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(circleRpc(11155111, 'eth_chainId', [])).rejects.toThrow('not available');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds payloads and unreadable responses', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<html>proxy failed</html>')); vi.stubGlobal('fetch', fetcher);
    await expect(request()).rejects.toBeInstanceOf(CircleServiceError);
    await expect(circleRpc(84532, 'eth_sendUserOperation', ['x'.repeat(524_288)])).rejects.toThrow('too large');
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockResolvedValue(reply({ jsonrpc: '2.0', id: 1, result: 'x'.repeat(524_288) }));
    await expect(request()).rejects.toThrow('unreadable');
  });
});
