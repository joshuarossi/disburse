"use node";
import { v } from "convex/values";
import { Resend } from "resend";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { EmailDeliveryError, openEmail, sendEmail } from "./lib/email";

export const deliver = internalAction({
  args: { deliveryId: v.id("emailDeliveries") },
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(internal.emailDeliveryData.claim, args);
    if (!claim) return;
    try {
      const payload = openEmail(claim.sealedPayload, claim.context);
      if (payload.to.length !== 1 || payload.to[0] !== claim.expectedEmail)
        throw new EmailDeliveryError(
          "The saved email recipient does not match the invitation.",
          false,
        );
      const providerId = await sendEmail(
        payload,
        `disburse-invite/${args.deliveryId}`,
      );
      await ctx.runMutation(internal.emailDeliveryData.complete, {
        ...args,
        attempt: claim.attempt,
        providerId,
      });
    } catch (error) {
      await ctx.runMutation(internal.emailDeliveryData.complete, {
        ...args,
        attempt: claim.attempt,
        error:
          error instanceof EmailDeliveryError
            ? error.message
            : "Email delivery could not be confirmed. A retry will use the same message.",
        retryable: error instanceof EmailDeliveryError ? error.retryable : true,
      });
    }
  },
});
export const webhook = internalAction({
  args: {
    payload: v.string(),
    id: v.string(),
    timestamp: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args): Promise<number> => {
    if (!process.env.RESEND_WEBHOOK_SECRET) return 503;
    let event: ReturnType<Resend["webhooks"]["verify"]>;
    try {
      event = new Resend(
        process.env.RESEND_API_KEY || "verification-only",
      ).webhooks.verify({
        payload: args.payload,
        headers: {
          id: args.id,
          timestamp: args.timestamp,
          signature: args.signature,
        },
        webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
      });
    } catch {
      return 400;
    }
    const kinds = {
      "email.sent": "submitted",
      "email.delivered": "delivered",
      "email.bounced": "bounced",
      "email.failed": "failed",
      "email.complained": "failed",
      "email.suppressed": "failed",
    } as const;
    if (!(event.type in kinds)) return 200;
    const providerId = (event.data as { email_id?: string }).email_id,
      occurredAt = Date.parse(event.created_at);
    if (
      !providerId ||
      !Number.isFinite(occurredAt) ||
      occurredAt > Date.now() + 5 * 60_000
    )
      return 400;
    return (await ctx.runMutation(internal.emailDeliveryData.providerEvent, {
      providerId,
      eventId: args.id,
      occurredAt,
      kind: kinds[event.type as keyof typeof kinds],
    }))
      ? 200
      : 503;
  },
});
