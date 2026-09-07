import type { TestConvex } from 'convex-test';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { internal } from '../_generated/api';

export async function refreshReportIndex(t: TestConvex<typeof schema>, orgId: Id<'orgs'>) {
  for (let page = 0; page < 1000; page++) {
    await t.mutation(internal.reportIndex.backfill, { orgId });
    const state = await t.run(ctx => ctx.db.query('reportIndexStates').withIndex('by_org', q => q.eq('orgId', orgId)).unique());
    if (state?.stage === 'done') break;
    if (page === 999) throw new Error('Test report backfill did not complete');
  }
  for (let page = 0; page < 1000; page++) {
    const jobs = await t.run(ctx => ctx.db.query('reportIndexJobs').withIndex('by_org_error', q => q.eq('orgId', orgId)).take(100));
    if (!jobs.length) return;
    for (const job of jobs) await t.mutation(internal.reportIndex.processJob, { jobId: job._id });
  }
  throw new Error('Test report projection did not complete');
}
