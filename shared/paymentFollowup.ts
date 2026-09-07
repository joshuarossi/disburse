const DAY = 86_400_000;
export type PaymentFollowupPhase =
  | "review"
  | "due_soon"
  | "approval_late"
  | "payment_late"
  | "settlement_delayed"
  | "failed"
  | "schedule_paused";
export type FollowupPayment = { status: string; scheduledAt?: number };
export function paymentFollowup(
  payment: FollowupPayment,
  now: number,
): { phase: PaymentFollowupPhase | null; nextAt: number; revisionKey: string } {
  const payAt = payment.scheduledAt;
  const closed = { phase: null, nextAt: 0, revisionKey: "closed" };
  if (!payAt || ["executed", "cancelled"].includes(payment.status))
    return closed;
  let phase: PaymentFollowupPhase | null = null;
  let nextAt = now + DAY;
  if (payment.status === "failed") phase = "failed";
  else if (payment.status === "relaying") {
    if (now >= payAt + 10 * 60_000) phase = "settlement_delayed";
    else nextAt = payAt + 10 * 60_000;
  } else if (payment.status === "scheduled") {
    if (now >= payAt + 5 * 60_000) phase = "payment_late";
    else nextAt = payAt + 5 * 60_000;
  } else if (["draft", "pending", "proposed"].includes(payment.status)) {
    if (now >= payAt) phase = "approval_late";
    else if (now >= payAt - DAY) {
      phase = "due_soon";
      nextAt = payAt;
    } else if (now >= payAt - 3 * DAY) {
      phase = "review";
      nextAt = payAt - DAY;
    } else nextAt = payAt - 3 * DAY;
  } else return closed;
  const repeatsDaily = phase && !["review", "due_soon"].includes(phase);
  return {
    phase,
    nextAt,
    revisionKey: `${payAt}:${phase ?? "waiting"}${repeatsDaily ? `:${Math.floor(now / DAY)}` : ""}`,
  };
}

export const paymentFollowupCopy: Record<
  PaymentFollowupPhase,
  { title: string; description: string; urgent: boolean }
> = {
  schedule_paused: {
    title: "Schedule needs attention",
    description:
      "Draft preparation was paused. Resolve the issue and resume for the next future pay date; missed periods are not paid automatically.",
    urgent: true,
  },
  review: {
    title: "Payment ready for review",
    description:
      "Review the prepared payment and collect account approvals before its pay date.",
    urgent: false,
  },
  due_soon: {
    title: "Approval deadline is approaching",
    description:
      "This payment is due within 24 hours. Complete approvals and schedule it before the deadline.",
    urgent: true,
  },
  approval_late: {
    title: "Approval deadline missed",
    description:
      "This payment was not scheduled before its pay date. Review the original payment and choose when to send it; no catch-up payment is sent automatically.",
    urgent: true,
  },
  payment_late: {
    title: "Scheduled payment needs attention",
    description:
      "The pay time has passed. Check the original submission and its recovery status before creating another payment.",
    urgent: true,
  },
  settlement_delayed: {
    title: "Payment confirmation is delayed",
    description:
      "The original payment is still being checked. Review its settlement status; do not create a replacement while the outcome is unknown.",
    urgent: true,
  },
  failed: {
    title: "Scheduled payment failed",
    description: "Review the failure and the original payment before retrying.",
    urgent: true,
  },
};
