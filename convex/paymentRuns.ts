import { PAYMENT_OPERATOR_ROLES } from "../shared/roles";
import {
  resolveFundingAccount,
  recurringFundingId,
} from "./lib/fundingAccount";
import { configuredTokenAddress } from "../shared/assets";
import {
  CHAIN_NAMES,
  CHAIN_TOKENS,
  type SupportedChainId,
} from "../shared/chains";
import { assertMemberPaymentPolicy } from "./lib/paymentLimits";
import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";
import {
  amountToBaseUnits,
  assertValidAddress,
  formatBaseUnits,
} from "./lib/validation";
import { assertFutureSchedule } from "./lib/disbursementPolicy";
import { appendAudit } from "./audit";
import { nextPayDate, PREPARATION_LEAD_MS } from "../shared/recurrence";
import { assertPayoutInstructions } from "../shared/payoutInstructions";
import { assertApprovedRecipient } from "../shared/recipientAssurance";
import {
  notifyPausedSchedule,
  resolveScheduleReminder,
} from "./lib/scheduleNotifications";

const recipientValidator = v.object({
  beneficiaryId: v.id("beneficiaries"),
  amount: v.string(),
});
const purposeValidator = v.union(
  v.literal("payroll"),
  v.literal("invoice"),
  v.literal("other"),
);
const cadenceValidator = v.union(
  v.literal("weekly"),
  v.literal("biweekly"),
  v.literal("monthly"),
);

type RunInput = {
  orgId: Id<"orgs">;
  name: string;
  purpose: "payroll" | "invoice" | "other";
  chainId: number;
  safeId?: Id<"safes">;
  token: string;
  payDate?: number;
  recipients: Array<{ beneficiaryId: Id<"beneficiaries">; amount: string }>;
};

async function validateRecipients(ctx: MutationCtx, input: RunInput) {
  if (!input.name.trim() || input.name.trim().length > 120)
    throw new Error("Give this pay run a name of 1 to 120 characters");
  if (!input.recipients.length || input.recipients.length > 200)
    throw new Error("A pay run needs between 1 and 200 recipients");
  if (
    new Set(input.recipients.map((r) => r.beneficiaryId)).size !==
    input.recipients.length
  )
    throw new Error("Each recipient can appear only once");
  const tokens = CHAIN_TOKENS[input.chainId as SupportedChainId];
  if (!tokens || !Object.keys(tokens).includes(input.token.toUpperCase()))
    throw new Error(
      "This currency is not supported by the selected funding account",
    );
  const safe = await resolveFundingAccount(ctx, input);
  let total = 0n;
  const recipients = [];
  for (const recipient of input.recipients) {
    const beneficiary = await ctx.db.get(recipient.beneficiaryId);
    if (
      !beneficiary ||
      beneficiary.orgId !== input.orgId ||
      !beneficiary.isActive
    )
      throw new Error(
        "A selected recipient is no longer active in this organization",
      );
    assertPayoutInstructions(beneficiary, input);
    assertApprovedRecipient(beneficiary);
    assertValidAddress(beneficiary.walletAddress);
    total += amountToBaseUnits(recipient.amount, input.token);
    recipients.push({
      ...recipient,
      recipientAddress: beneficiary.walletAddress,
      recipientName: beneficiary.name,
      payoutVersion: beneficiary.payoutVersion,
    });
  }
  return { safe, recipients, totalAmount: formatBaseUnits(total, input.token) };
}

export async function prepareRun(
  ctx: MutationCtx,
  input: RunInput,
  createdBy: Id<"users">,
  recurringPaymentId?: Id<"recurringPayments">,
) {
  const validated = await validateRecipients(ctx, input);
  await assertMemberPaymentPolicy(
    ctx,
    input.orgId,
    createdBy,
    input.token,
    validated.totalAmount,
    input.payDate ?? Date.now(),
  );
  const now = Date.now();
  const disbursementId = await ctx.db.insert("disbursements", {
    followupAt: input.payDate ? now : 0,
    orgId: input.orgId,
    safeId: validated.safe._id,
    chainId: input.chainId,
    name: input.name.trim(),
    purpose: input.purpose,
    token: input.token.toUpperCase(),
    tokenAddress: configuredTokenAddress(
      input.chainId,
      input.token.toUpperCase(),
    ),
    type: "batch",
    totalAmount: validated.totalAmount,
    memo: input.name.trim(),
    scheduledAt: input.payDate,
    recurringPaymentId,
    status: "draft",
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
  for (const recipient of validated.recipients) {
    await ctx.db.insert("disbursementRecipients", {
      ...recipient,
      disbursementId,
      createdAt: now,
    });
  }
  await appendAudit(ctx, {
    orgId: input.orgId,
    actorUserId: createdBy,
    action: "disbursement.created",
    objectType: "disbursement",
    objectId: disbursementId,
    metadata: {
      name: input.name.trim(),
      purpose: input.purpose,
      recipientCount: validated.recipients.length,
      totalAmount: validated.totalAmount,
      recurring: !!recurringPaymentId,
    },
    timestamp: now,
  });
  return disbursementId;
}

async function createRunWithSeries(
  ctx: MutationCtx,
  args: RunInput & { cadence?: "weekly" | "biweekly" | "monthly" },
  userId: Id<"users">,
) {
  if (args.payDate !== undefined)
    assertFutureSchedule(args.payDate, Date.now());
  // Validate before inserting the recurring series or its first run.
  const validated = await validateRecipients(ctx, args);
  const boundArgs = { ...args, safeId: validated.safe._id };
  let recurringPaymentId: Id<"recurringPayments"> | undefined;
  if (args.cadence) {
    if (args.payDate === undefined)
      throw new Error("A recurring payment needs a future first pay date");
    const now = Date.now();
    const anchorDay = new Date(args.payDate).getUTCDate();
    const nextDate = nextPayDate(args.payDate, args.cadence, anchorDay);
    recurringPaymentId = await ctx.db.insert("recurringPayments", {
      orgId: args.orgId,
      name: args.name.trim(),
      purpose: args.purpose,
      chainId: args.chainId,
      safeId: validated.safe._id,
      token: args.token.toUpperCase(),
      recipients: args.recipients,
      cadence: args.cadence,
      anchorDay,
      nextPayDate: nextDate,
      status: "active",
      version: 1,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(
      Math.max(now, nextDate - PREPARATION_LEAD_MS),
      internal.paymentRuns.prepareNext,
      { recurringPaymentId, version: 1 },
    );
  }
  const disbursementId = await prepareRun(
    ctx,
    boundArgs,
    userId,
    recurringPaymentId,
  );
  if (recurringPaymentId)
    await ctx.db.patch(recurringPaymentId, {
      lastDisbursementId: disbursementId,
    });
  return { disbursementId, recurringPaymentId };
}

export const create = mutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    name: v.string(),
    purpose: purposeValidator,
    chainId: v.number(),
    safeId: v.optional(v.id("safes")),
    token: v.string(),
    payDate: v.optional(v.number()),
    recipients: v.array(recipientValidator),
    cadence: v.optional(cadenceValidator),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      [...PAYMENT_OPERATOR_ROLES],
    );
    return createRunWithSeries(ctx, args, user._id);
  },
});

/** Create all compatible batches atomically, using the instructions reviewed by the user. */
export const createGrouped = mutation({
  args: {
    orgId: v.id("orgs"),
    sessionToken: v.string(),
    name: v.string(),
    purpose: purposeValidator,
    payDate: v.optional(v.number()),
    cadence: v.optional(cadenceValidator),
    recipients: v.array(
      v.object({
        beneficiaryId: v.id("beneficiaries"),
        amount: v.string(),
        chainId: v.number(),
        safeId: v.optional(v.id("safes")),
        token: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(
      ctx,
      args.orgId,
      args.sessionToken,
      [...PAYMENT_OPERATOR_ROLES],
    );
    if (!args.name.trim() || args.name.trim().length > 120)
      throw new Error("Give this pay run a name of 1 to 120 characters");
    if (!args.recipients.length || args.recipients.length > 200)
      throw new Error("A pay run needs between 1 and 200 recipients");
    if (
      new Set(args.recipients.map((r) => r.beneficiaryId)).size !==
      args.recipients.length
    )
      throw new Error("Each recipient can appear only once");
    const groups = new Map<
      string,
      {
        chainId: number;
        safeId: Id<"safes">;
        token: string;
        recipients: RunInput["recipients"];
      }
    >();
    for (const recipient of args.recipients) {
      const token = recipient.token.toUpperCase();
      const safe = await resolveFundingAccount(ctx, {
        ...recipient,
        orgId: args.orgId,
      });
      const key = `${safe._id}:${token}`;
      const group = groups.get(key) ?? {
        chainId: recipient.chainId,
        safeId: safe._id,
        token,
        recipients: [],
      };
      group.recipients.push({
        beneficiaryId: recipient.beneficiaryId,
        amount: recipient.amount,
      });
      groups.set(key, group);
    }
    // A per-payment limit applies to the whole requested run for each currency,
    // so splitting across networks cannot bypass it.
    const totals = new Map<string, bigint>();
    for (const recipient of args.recipients) {
      const token = recipient.token.toUpperCase();
      totals.set(
        token,
        (totals.get(token) ?? 0n) + amountToBaseUnits(recipient.amount, token),
      );
    }
    for (const [token, total] of totals)
      await assertMemberPaymentPolicy(
        ctx,
        args.orgId,
        user._id,
        token,
        formatBaseUnits(total, token),
        args.payDate ?? Date.now(),
      );
    const batches = [];
    for (const group of groups.values()) {
      const suffix =
        groups.size > 1
          ? ` · ${group.token} · ${CHAIN_NAMES[group.chainId as SupportedChainId]}`
          : "";
      const result = await createRunWithSeries(
        ctx,
        {
          orgId: args.orgId,
          name: args.name.trim().slice(0, 120 - suffix.length) + suffix,
          purpose: args.purpose,
          payDate: args.payDate,
          cadence: args.cadence,
          ...group,
        },
        user._id,
      );
      batches.push({
        ...result,
        chainId: group.chainId,
        safeId: group.safeId,
        token: group.token,
        recipientCount: group.recipients.length,
      });
    }
    return { batches };
  },
});

export const listRecurring = query({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.orgId, args.sessionToken, [
      "admin",
      "approver",
      "initiator",
      "clerk",
      "viewer",
    ]);
    const series = await ctx.db
      .query("recurringPayments")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return (
      await Promise.all(
        series.map(async (series) => {
          const latest = series.lastDisbursementId
            ? await ctx.db.get(series.lastDisbursementId)
            : null;
          const owner = await ctx.db
            .query("orgMemberships")
            .withIndex("by_org_and_user", (q) =>
              q.eq("orgId", args.orgId).eq("userId", series.createdBy),
            )
            .first();
          return {
            ...series,
            nextDraftAt: series.nextPayDate - PREPARATION_LEAD_MS,
            ownerName: owner?.name ?? "Schedule creator",
            coordinatorActive:
              owner?.status === "active" &&
              PAYMENT_OPERATOR_ROLES.some((role) => role === owner.role),
            latestPayment:
              latest?.orgId === args.orgId
                ? {
                    _id: latest._id,
                    safeId: latest.safeId,
                    status: latest.status,
                    scheduledAt: latest.scheduledAt,
                    name: latest.name,
                    relayStatus: latest.relayStatus,
                  }
                : null,
            totalAmount: formatBaseUnits(
              series.recipients.reduce(
                (total, r) => total + amountToBaseUnits(r.amount, series.token),
                0n,
              ),
              series.token,
            ),
          };
        }),
      )
    ).sort((a, b) => a.nextPayDate - b.nextPayDate);
  },
});

export const setRecurringStatus = mutation({
  args: {
    recurringPaymentId: v.id("recurringPayments"),
    sessionToken: v.string(),
    status: v.union(v.literal("active"), v.literal("paused")),
  },
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.recurringPaymentId);
    if (!series) throw new Error("Recurring payment not found");
    const { user } = await requireOrgAccess(
      ctx,
      series.orgId,
      args.sessionToken,
      [...PAYMENT_OPERATOR_ROLES],
    );
    if (series.status === args.status) return;
    const now = Date.now();
    let nextDate = series.nextPayDate;
    // Resuming never creates a backlog of payments for missed periods.
    while (nextDate <= now)
      nextDate = nextPayDate(nextDate, series.cadence, series.anchorDay);
    const version = series.version + 1;
    if (args.status === "active") {
      const safeId = await recurringFundingId(ctx, series);
      const checked = await validateRecipients(ctx, {
        ...series,
        safeId,
        payDate: nextDate,
      });
      await ctx.db.patch(series._id, { safeId: checked.safe._id });
      await ctx.scheduler.runAt(
        Math.max(now, nextDate - PREPARATION_LEAD_MS),
        internal.paymentRuns.prepareNext,
        { recurringPaymentId: series._id, version },
      );
    }
    await ctx.db.patch(series._id, {
      status: args.status,
      version,
      nextPayDate: nextDate,
      pauseReason: undefined,
      createdBy: user._id,
      updatedAt: now,
    });
    await resolveScheduleReminder(ctx, series);
    await appendAudit(ctx, {
      orgId: series.orgId,
      actorUserId: user._id,
      action: `recurring.${args.status}`,
      objectType: "recurringPayment",
      objectId: series._id,
      timestamp: now,
    });
  },
});

export const prepareNext = internalMutation({
  args: { recurringPaymentId: v.id("recurringPayments"), version: v.number() },
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.recurringPaymentId);
    if (
      !series ||
      series.status !== "active" ||
      series.version !== args.version
    )
      return;
    const now = Date.now();
    if (now < series.nextPayDate - PREPARATION_LEAD_MS) return;
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("orgId", series.orgId).eq("userId", series.createdBy),
      )
      .first();
    let reason: string | undefined;
    let fundingId = series.safeId;
    if (
      !membership ||
      membership.status !== "active" ||
      !PAYMENT_OPERATOR_ROLES.some((role) => role === membership.role)
    )
      reason =
        "The schedule owner no longer has permission to create payments.";
    if (series.nextPayDate <= now)
      reason =
        "The pay date was missed. Resume to prepare the next future run.";
    if (!reason) {
      try {
        fundingId = await recurringFundingId(ctx, series);
        const checked = await validateRecipients(ctx, {
          ...series,
          safeId: fundingId,
          payDate: series.nextPayDate,
        });
        fundingId = checked.safe._id;
        await assertMemberPaymentPolicy(
          ctx,
          series.orgId,
          series.createdBy,
          series.token,
          checked.totalAmount,
          series.nextPayDate,
        );
      } catch (error) {
        reason =
          error instanceof Error
            ? error.message
            : "Recipients or funding account need attention.";
      }
    }
    if (reason) {
      await notifyPausedSchedule(ctx, series, reason);
      await ctx.db.patch(series._id, {
        status: "paused",
        pauseReason: reason,
        version: series.version + 1,
        updatedAt: now,
      });
      await appendAudit(ctx, {
        orgId: series.orgId,
        actorUserId: series.createdBy,
        action: "recurring.paused",
        objectType: "recurringPayment",
        objectId: series._id,
        metadata: { reason },
        timestamp: now,
      });
      return;
    }
    const existing = await ctx.db
      .query("disbursements")
      .withIndex("by_recurring_pay_date", (q) =>
        q
          .eq("recurringPaymentId", series._id)
          .eq("scheduledAt", series.nextPayDate),
      )
      .first();
    const disbursementId =
      existing?._id ??
      (await prepareRun(
        ctx,
        { ...series, safeId: fundingId, payDate: series.nextPayDate },
        series.createdBy,
        series._id,
      ));
    // Screening is enforced when the run is approved or scheduled; the draft
    // remains visible for a finance reviewer to resolve any blocked recipients.
    const nextDate = nextPayDate(
      series.nextPayDate,
      series.cadence,
      series.anchorDay,
    );
    const version = series.version + 1;
    await ctx.db.patch(series._id, {
      nextPayDate: nextDate,
      safeId: fundingId,
      lastDisbursementId: disbursementId,
      version,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(
      Math.max(now, nextDate - PREPARATION_LEAD_MS),
      internal.paymentRuns.prepareNext,
      { recurringPaymentId: series._id, version },
    );
  },
});

export const updateRecurring = mutation({
  args: {
    recurringPaymentId: v.id("recurringPayments"),
    sessionToken: v.string(),
    name: v.string(),
    cadence: cadenceValidator,
    nextPayDate: v.number(),
    recipients: v.array(recipientValidator),
  },
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.recurringPaymentId);
    if (!series) throw new Error("Recurring payment not found");
    const { user } = await requireOrgAccess(
      ctx,
      series.orgId,
      args.sessionToken,
      [...PAYMENT_OPERATOR_ROLES],
    );
    assertFutureSchedule(args.nextPayDate, Date.now());
    const fields = {
      ...series,
      safeId: await recurringFundingId(ctx, series),
      name: args.name,
      recipients: args.recipients,
      payDate: args.nextPayDate,
    };
    const validated = await validateRecipients(ctx, fields);
    await assertMemberPaymentPolicy(
      ctx,
      series.orgId,
      user._id,
      series.token,
      validated.totalAmount,
      args.nextPayDate,
    );
    const existing = await ctx.db
      .query("disbursements")
      .withIndex("by_recurring_pay_date", (q) =>
        q
          .eq("recurringPaymentId", series._id)
          .eq("scheduledAt", args.nextPayDate),
      )
      .first();
    if (existing)
      throw new Error(
        "A batch already exists for that pay date. Review that batch or choose another future date.",
      );
    const version = series.version + 1;
    await ctx.db.patch(series._id, {
      name: args.name.trim(),
      safeId: validated.safe._id,
      cadence: args.cadence,
      anchorDay: new Date(args.nextPayDate).getUTCDate(),
      nextPayDate: args.nextPayDate,
      recipients: args.recipients,
      version,
      createdBy: user._id,
      updatedAt: Date.now(),
      pauseReason: undefined,
    });
    await resolveScheduleReminder(ctx, series);
    if (series.status === "active")
      await ctx.scheduler.runAt(
        Math.max(Date.now(), args.nextPayDate - PREPARATION_LEAD_MS),
        internal.paymentRuns.prepareNext,
        { recurringPaymentId: series._id, version },
      );
    await appendAudit(ctx, {
      orgId: series.orgId,
      actorUserId: user._id,
      action: "recurring.updated",
      objectType: "recurringPayment",
      objectId: series._id,
      metadata: {
        nextPayDate: args.nextPayDate,
        cadence: args.cadence,
        recipientCount: args.recipients.length,
      },
      timestamp: Date.now(),
    });
  },
});

export const updateDraft = mutation({
  args: {
    disbursementId: v.id("disbursements"),
    sessionToken: v.string(),
    name: v.string(),
    purpose: purposeValidator,
    chainId: v.number(),
    safeId: v.optional(v.id("safes")),
    token: v.string(),
    payDate: v.optional(v.number()),
    recipients: v.array(recipientValidator),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error("Payment not found");
    const { user } = await requireOrgAccess(
      ctx,
      payment.orgId,
      args.sessionToken,
      [...PAYMENT_OPERATOR_ROLES],
    );
    if (
      payment.status !== "draft" ||
      payment.paymentScheduleId ||
      payment.safeTxHash ||
      payment.type !== "batch"
    )
      throw new Error("Only an unsigned batch draft can be edited");
    const linkedBill = await ctx.db
      .query("invoices")
      .withIndex("by_payment", (q) => q.eq("disbursementId", payment._id))
      .first();
    if (linkedBill)
      throw new Error(
        "This batch pays recorded bills. Cancel it and edit the bills before preparing a replacement.",
      );
    if (args.payDate !== undefined)
      assertFutureSchedule(args.payDate, Date.now());
    if (payment.recurringPaymentId && args.payDate !== payment.scheduledAt)
      throw new Error(
        "Keep this occurrence on its original pay date. Edit the recurring schedule for future dates.",
      );
    const validated = await validateRecipients(ctx, {
      ...args,
      safeId:
        args.safeId ??
        (args.chainId === payment.chainId ? payment.safeId : undefined),
      orgId: payment.orgId,
    });
    await assertMemberPaymentPolicy(
      ctx,
      payment.orgId,
      payment.createdBy,
      args.token,
      validated.totalAmount,
      args.payDate ?? Date.now(),
      payment._id,
    );
    const existing = await ctx.db
      .query("disbursementRecipients")
      .withIndex("by_disbursement", (q) => q.eq("disbursementId", payment._id))
      .collect();
    const snapshots = new Map(existing.map((r) => [r.beneficiaryId, r]));
    for (const row of validated.recipients) {
      const previous = snapshots.get(row.beneficiaryId);
      if (
        previous &&
        (previous.payoutVersion !== row.payoutVersion ||
          previous.recipientAddress.toLowerCase() !==
            row.recipientAddress.toLowerCase())
      )
        throw new Error(
          "Recipient payout details have changed. Cancel this draft and prepare a new payment with the reviewed details.",
        );
    }
    for (const row of existing) await ctx.db.delete(row._id);
    for (const row of validated.recipients) {
      const previous = snapshots.get(row.beneficiaryId);
      await ctx.db.insert("disbursementRecipients", {
        ...row,
        recipientAddress: previous?.recipientAddress ?? row.recipientAddress,
        recipientName: previous?.recipientName ?? row.recipientName,
        disbursementId: payment._id,
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch(payment._id, {
      name: args.name.trim(),
      memo: args.name.trim(),
      purpose: args.purpose,
      chainId: args.chainId,
      safeId: validated.safe._id,
      token: args.token.toUpperCase(),
      tokenAddress: configuredTokenAddress(
        args.chainId,
        args.token.toUpperCase(),
      ),
      scheduledAt: args.payDate,
      followupAt: Date.now(),
      totalAmount: validated.totalAmount,
      executionFee: undefined,
      relayFeeToken: undefined,
      relayFeeTokenSymbol: undefined,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      orgId: payment.orgId,
      actorUserId: user._id,
      action: "disbursement.draft_updated",
      objectType: "disbursement",
      objectId: payment._id,
      metadata: {
        previousAmount: payment.totalAmount,
        totalAmount: validated.totalAmount,
        recipientCount: args.recipients.length,
      },
      timestamp: Date.now(),
    });
    return { disbursementId: payment._id };
  },
});
