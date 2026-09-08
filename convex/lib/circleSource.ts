import { v } from "convex/values";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import { requireOrgAccess } from "./rbac";
import { ORG_READER_ROLES, PAYMENT_OPERATOR_ROLES } from "../../shared/roles";
import { assertPaymentMayProceed } from "./disbursementPolicy";
import { verificationContext } from "../disbursements";
import { grantAccess } from "../spendingPolicyData";
import { assertCurrent } from "../accountCancellationData";
import { readReceivingSource } from "./circleReceivables";
import { readBillingSource } from "./circleBilling";
import { readAccountSetupSource } from "./circleAccountSetup";
import {
  assertCircleQueueCompatible,
  MAX_OPEN_CIRCLE_REQUESTS,
} from "../../shared/circleQueue";
import { decodeCircleRequest } from "../../shared/circleRequest";

export const circleSourceArgs = {
  disbursementId: v.optional(v.id("disbursements")),
  policyChangeId: v.optional(v.id("spendingPolicyChanges")),
  cancellationId: v.optional(v.id("accountCancellations")),
  receivableId: v.optional(v.id("receivables")),
  receivingSetupSafeId: v.optional(v.id("safes")),
  billingCheckoutId: v.optional(v.id("billingCheckouts")),
  accountSetupId: v.optional(v.id("accountSetups")),
};
export type CircleSource = {
  disbursementId?: Id<"disbursements">;
  policyChangeId?: Id<"spendingPolicyChanges">;
  cancellationId?: Id<"accountCancellations">;
  receivableId?: Id<"receivables">;
  receivingSetupSafeId?: Id<"safes">;
  billingCheckoutId?: Id<"billingCheckouts">;
  accountSetupId?: Id<"accountSetups">;
};
export function circleSourceIdentity(s: CircleSource) {
  if (
    [
      s.disbursementId,
      s.policyChangeId,
      s.cancellationId,
      s.receivableId,
      s.receivingSetupSafeId,
      s.billingCheckoutId,
      s.accountSetupId,
    ].filter(Boolean).length !== 1
  )
    throw new Error("Choose one account instruction");
  if (s.accountSetupId) return { accountSetupId: s.accountSetupId };
  if (s.billingCheckoutId) return { billingCheckoutId: s.billingCheckoutId };
  if (s.receivableId) return { receivableId: s.receivableId };
  if (s.receivingSetupSafeId)
    return { receivingSetupSafeId: s.receivingSetupSafeId };
  return s.disbursementId
    ? { disbursementId: s.disbursementId }
    : s.policyChangeId
      ? { policyChangeId: s.policyChangeId }
      : { cancellationId: s.cancellationId! };
}
export async function readCircleSource(
  ctx: QueryCtx,
  source: CircleSource,
  sessionToken: string,
  write = false,
) {
  const identity = circleSourceIdentity(source);
  if (identity.accountSetupId)
    return readAccountSetupSource(
      ctx,
      identity.accountSetupId,
      sessionToken,
      write,
    );
  if (identity.billingCheckoutId)
    return readBillingSource(
      ctx,
      identity.billingCheckoutId,
      sessionToken,
      write,
    );
  if (identity.receivableId || identity.receivingSetupSafeId)
    return readReceivingSource(ctx, identity, sessionToken, write);
  const target = identity.disbursementId
    ? await ctx.db.get(identity.disbursementId)
    : identity.policyChangeId
      ? await ctx.db.get(identity.policyChangeId)
      : await ctx.db.get(identity.cancellationId!);
  if (!target)
    throw new Error("The original account instruction was not found");
  const { user } = await requireOrgAccess(
    ctx,
    target.orgId,
    sessionToken,
    write
      ? identity.disbursementId
        ? PAYMENT_OPERATOR_ROLES
        : ["admin", "approver"]
      : ORG_READER_ROLES,
  );
  const safe = await ctx.db.get(target.safeId);
  if (!safe || safe.orgId !== target.orgId || safe.chainId !== target.chainId)
    throw new Error("The original company account changed");
  let snapshot = JSON.stringify({
    id: target._id,
    hash: target.safeTxHash,
    safeId: target.safeId,
    status: target.status,
  });
  if (write) {
    if (target.executionFee)
      throw new Error(
        "Finish the original execution fee request before using another service",
      );
    if (identity.disbursementId) {
      const payment = (await ctx.db.get(identity.disbursementId))!;
      if (
        payment.status !== "proposed" ||
        payment.allowanceExecution ||
        !payment.safeTxHash
      )
        throw new Error(
          "Finish the original payment approvals before reviewing execution fees",
        );
      await assertPaymentMayProceed(ctx, payment);
      snapshot = (
        await verificationContext(ctx, {
          disbursementId: payment._id,
          sessionToken,
        })
      ).snapshot;
    } else if (identity.policyChangeId) {
      const policy = (await ctx.db.get(identity.policyChangeId))!;
      if (policy.status !== "pending" || policy.cancellationId)
        throw new Error("Check the original policy request before continuing");
      if (policy.intent.kind === "grant")
        await grantAccess(
          ctx,
          safe._id,
          policy.intent.delegate,
          policy.createdBy,
        );
    } else {
      const cancellation = (await ctx.db.get(identity.cancellationId!))!;
      if (cancellation.status !== "pending")
        throw new Error("Check the original cancellation before continuing");
      await assertCurrent(ctx, cancellation);
    }
  }
  const kind = identity.disbursementId
    ? "disbursement"
    : identity.policyChangeId
      ? "spending_policy"
      : "account_cancellation";
  return {
    identity,
    target,
    safe,
    user,
    snapshot,
    kind,
    sourceId: target._id,
    directCall: false as const,
  };
}
export async function verifyCircleSource(
  ctx: ActionCtx,
  source: CircleSource,
  sessionToken: string,
): Promise<{ to: string; data: string }> {
  const identity = circleSourceIdentity(source);
  if (identity.accountSetupId)
    return ctx.runAction(internal.accountSetups.verify, {
      accountSetupId: identity.accountSetupId,
      sessionToken,
    });
  if (identity.billingCheckoutId) {
    const data = await ctx.runQuery(internal.circleBilling.context, {
      billingCheckoutId: identity.billingCheckoutId,
      sessionToken,
    });
    return data.call;
  }
  if (identity.receivableId || identity.receivingSetupSafeId)
    return ctx.runAction(internal.receivableServices.verify, {
      ...identity,
      sessionToken,
    });
  if (identity.disbursementId)
    return ctx.runAction(api.accountApprovals.execution, {
      disbursementId: identity.disbursementId,
      sessionToken,
    });
  if (identity.policyChangeId)
    return ctx.runAction(internal.spendingPolicies.verifyExecution, {
      policyChangeId: identity.policyChangeId,
      sessionToken,
    });
  return ctx.runAction(internal.accountCancellations.verifyExecution, {
    cancellationId: identity.cancellationId!,
    sessionToken,
  });
}

export async function assertCircleReservation(
  ctx: QueryCtx,
  safeId: Id<"safes">,
  executionId?: Id<"circleExecutions">,
) {
  const safe = await ctx.db.get(safeId);
  if (!safe) throw new Error("Company account not found");
  const key = `${safe.chainId}:${safe.safeAddress.toLowerCase()}`;
  if (executionId) {
    const execution = await ctx.db.get(executionId);
    if (!execution || execution.accountKey !== key || !execution.open)
      throw new Error(
        "The saved fee request belongs to another account or is closed.",
      );
    if (execution.concurrentFees) {
      const open = await openCircleRequests(ctx, key);
      assertCircleQueueCompatible(
        decodeCircleRequest(execution.record),
        open
          .filter((e) => e._id !== executionId)
          .map((e) => ({
            concurrentFees: e.concurrentFees,
            request: decodeCircleRequest(e.record),
          })),
      );
      return;
    }
  }
  const open = await ctx.db
    .query("circleExecutions")
    .withIndex("by_account_open", (q) =>
      q.eq("accountKey", key).eq("open", true),
    )
    .first();
  if (open && open._id !== executionId)
    throw new Error(
      "This account has a saved USDC fee request. Complete or check that request first.",
    );
}

export async function openCircleRequests(ctx: QueryCtx, accountKey: string) {
  return ctx.db
    .query("circleExecutions")
    .withIndex("by_account_open", (q) =>
      q.eq("accountKey", accountKey).eq("open", true),
    )
    .take(MAX_OPEN_CIRCLE_REQUESTS + 1);
}
