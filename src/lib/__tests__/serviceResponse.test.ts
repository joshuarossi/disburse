import { describe, expect, it, vi } from 'vitest';
import { readServiceJson } from '../../../shared/serviceResponse';

describe('bounded execution service responses', () => {
  it('decodes UTF-8 split between chunks without corrupting the JSON', async () => {
    const bytes = new TextEncoder().encode('{"message":"Confirmación"}');
    const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    await expect(readServiceJson(new Response(stream), 100, new AbortController().signal)).resolves.toEqual({ message: 'Confirmación' });
  });
  it('stops an endless response at the byte limit and cancels the stream', async () => {
    const cancel = vi.fn(); let reads = 0;
    const stream = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(32)); }, cancel });
    await expect(readServiceJson(new Response(stream), 64, new AbortController().signal)).rejects.toThrow('too large');
    expect(reads).toBeLessThanOrEqual(4);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects an oversized content length without consuming the body', async () => {
    const cancel = vi.fn(), pull = vi.fn();
    const stream = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
    await expect(readServiceJson(new Response(stream, { headers: { 'Content-Length': '99999999999999999999' } }), 64, new AbortController().signal)).rejects.toThrow('Invalid');
    expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  });
  it('interrupts a body that never finishes and does not wait on a stuck stream cancellation', async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream({ cancel });
    const result = readServiceJson(new Response(stream), 64, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('handles a request aborted before the body reader starts', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readServiceJson(new Response('{}'), 64, controller.signal)).rejects.toThrow();
  });
  it.each([new Uint8Array([0xff]), new TextEncoder().encode('<html>gateway error</html>'), new TextEncoder().encode('{"incomplete":')])('refuses invalid UTF-8 or JSON', async bytes => {
    await expect(readServiceJson(new Response(bytes), 64, new AbortController().signal)).rejects.toThrow();
  });
});
