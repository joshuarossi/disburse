import { afterEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';
import { internal } from '../_generated/api';
const hash = `0x${'ab'.repeat(32)}`;
afterEach(() => vi.unstubAllGlobals());
it('only returns a well-formed legacy task hint for independent receipt verification', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ task: { taskId: 'old-task', taskState: 'ExecSuccess', transactionHash: hash } })));
  vi.stubGlobal('fetch', fetcher);
  expect(await convexTest(schema).action(internal.relay.getTaskStatus, { taskId: 'old-task' })).toEqual({ taskId: 'old-task', taskState: 'ExecSuccess', transactionHash: hash });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) });
});
it('rejects an invalid saved reference before making a provider request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(convexTest(schema).action(internal.relay.getTaskStatus, { taskId: '../tasks?key=secret' })).rejects.toThrow('reference is invalid');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  { task: { taskId: 'different-task', taskState: 'ExecSuccess', transactionHash: hash } },
  { task: { transactionHash: 'not-a-receipt' } },
  { task: { taskState: { unexpected: 'object' } } },
  { task: [] },
  { task: { taskState: 'x'.repeat(70_000) } },
])('keeps malformed, mismatched and oversized provider data out of recovery', async body => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  await expect(convexTest(schema).action(internal.relay.getTaskStatus, { taskId: 'old-task' })).rejects.toThrow('status is unavailable');
});
