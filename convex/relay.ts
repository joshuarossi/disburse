'use node';

import { v } from 'convex/values';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';

const GELATO_TASK_STATUS_URL = 'https://api.gelato.digital/tasks/status';

export const getTaskStatus = action({
  args: {
    taskId: v.string(),
  },
  handler: async (_ctx, args) => {
    console.info('[Relay] Fetching task status', { taskId: args.taskId });
    const response = await fetch(`${GELATO_TASK_STATUS_URL}/${args.taskId}`);
    if (!response.ok) {
      console.error('[Relay] Failed to fetch task status', {
        taskId: args.taskId,
        status: response.status,
      });
      throw new Error('Failed to fetch relay task status.');
    }

    const data = await response.json();
    const task = data?.task ?? data;

    console.info('[Relay] Task status response', {
      taskId: args.taskId,
      taskState: task?.taskState ?? task?.state ?? task?.status ?? null,
      transactionHash:
        task?.transactionHash ?? task?.txHash ?? task?.transaction_hash ?? null,
    });

    return {
      taskId: args.taskId,
      taskState: task?.taskState ?? task?.state ?? task?.status ?? null,
      transactionHash:
        task?.transactionHash ?? task?.txHash ?? task?.transaction_hash ?? null,
    };
  },
});

export const fireScheduledRelay = internalAction({
  args: { disbursementId: v.id('disbursements'), scheduledVersion: v.number() },
  handler: async (ctx, args): Promise<void> => { await ctx.runAction(internal.relayExecutor.fire, args); },
});
