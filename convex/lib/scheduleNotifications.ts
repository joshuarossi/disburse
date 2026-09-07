import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { chainEnvironment } from "../../shared/assets";

/** A preparation failure is operational work, not authorization to catch up. */
export async function notifyPausedSchedule(
  ctx: MutationCtx,
  series: Doc<"recurringPayments">,
  reason: string,
) {
  const previous = await ctx.db
    .query("paymentNotifications")
    .withIndex("by_series", (q) => q.eq("recurringPaymentId", series._id))
    .first();
  const members = await ctx.db
    .query("orgMemberships")
    .withIndex("by_org", (q) => q.eq("orgId", series.orgId))
    .take(1001);
  if (members.length > 1000)
    throw new Error(
      "The team is too large to resolve schedule reminders completely",
    );
  const fields = {
    orgId: series.orgId,
    environment: chainEnvironment(series.chainId),
    recurringPaymentId: series._id,
    phase: "schedule_paused",
    revisionKey: `paused:${series.version}:${reason}`,
    revision: (previous?.revision ?? 0) + 1,
    isOpen: true,
    coordinatorUserId: series.createdBy,
    assignedUserIds: members
      .filter(
        (m) =>
          m.status === "active" &&
          (m.role === "admin" ||
            (m.userId === series.createdBy &&
              ["approver", "initiator"].includes(m.role))),
      )
      .map((m) => m.userId),
    owners: [],
    updatedAt: Date.now(),
  };
  if (previous?.revisionKey === fields.revisionKey) return;
  if (previous) await ctx.db.patch(previous._id, fields);
  else
    await ctx.db.insert("paymentNotifications", {
      ...fields,
      createdAt: Date.now(),
    });
}

export async function resolveScheduleReminder(
  ctx: MutationCtx,
  series: Doc<"recurringPayments">,
) {
  const previous = await ctx.db
    .query("paymentNotifications")
    .withIndex("by_series", (q) => q.eq("recurringPaymentId", series._id))
    .first();
  if (previous?.isOpen)
    await ctx.db.patch(previous._id, { isOpen: false, updatedAt: Date.now() });
}
