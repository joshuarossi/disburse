'use node';

import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { readServiceJson } from '../shared/serviceResponse';

// Only background recovery can look up an existing legacy task. This endpoint
// cannot submit work, charge an account or act as a public unbounded proxy.
export const getTaskStatus = internalAction({
  args: { taskId: v.string() },
  handler: async (_ctx, args): Promise<{ taskId: string; taskState: string | null; transactionHash: string | null }> => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(args.taskId)) throw new Error('The saved payment service reference is invalid. Check the original payment receipt.');
    const signal = AbortSignal.timeout(15_000);
    try {
      const response = await fetch(`https://api.gelato.digital/tasks/status/${args.taskId}`, {
        signal, credentials: 'omit', redirect: 'error',
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error();
      }
      const data = await readServiceJson(response, 65_536, signal);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      const task = 'task' in data ? data.task : data;
      if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error();
      const record = task as Record<string, unknown>;
      if (record.taskId !== undefined && record.taskId !== args.taskId) throw new Error();
      const taskState = record.taskState ?? record.state ?? record.status ?? null;
      const transactionHash = record.transactionHash ?? record.txHash ?? record.transaction_hash ?? null;
      if (taskState !== null && (typeof taskState !== 'string' || taskState.length > 80)) throw new Error();
      if (transactionHash !== null && (typeof transactionHash !== 'string' || !/^0x[\da-f]{64}$/i.test(transactionHash))) throw new Error();
      return { taskId: args.taskId, taskState: taskState as string | null, transactionHash: transactionHash as string | null };
    } catch {
      throw new Error('The original payment service status is unavailable. Check the saved payment again shortly.');
    }
  },
});

export const fireScheduledRelay = internalAction({
  args: { disbursementId: v.id('disbursements'), scheduledVersion: v.number() },
  handler: async (ctx, args): Promise<void> => { await ctx.runAction(internal.relayExecutor.fire, args); },
});
