export type PayoutDetails = {
  walletAddress: string;
  preferredToken?: string;
  preferredChainId?: number;
};
export type ReviewedRecipient = PayoutDetails & {
  name: string;
  isActive: boolean;
  payoutVersion?: number;
  payoutReviewStatus?: "unreviewed" | "approved";
  pendingPayoutChangeId?: string;
};

export function payoutDetailsEqual(a: PayoutDetails, b: PayoutDetails) {
  return (
    a.walletAddress.toLowerCase() === b.walletAddress.toLowerCase() &&
    a.preferredToken === b.preferredToken &&
    a.preferredChainId === b.preferredChainId
  );
}

export function recipientPayoutIssue(
  recipient: ReviewedRecipient,
): string | null {
  if (!recipient.isActive) return "Archived";
  if (recipient.pendingPayoutChangeId) return "Payout review pending";
  if (!recipient.walletAddress) return "Payment details needed";
  if (recipient.payoutReviewStatus !== "approved" || !recipient.payoutVersion)
    return "Payout review needed";
  return null;
}

export function assertApprovedRecipient(recipient: ReviewedRecipient) {
  const issue = recipientPayoutIssue(recipient);
  if (issue)
    throw new Error(
      `${recipient.name}: ${issue}. Review the recipient before preparing or approving a payment.`,
    );
}

export function lookalikeAddress(a: string, b: string) {
  const left = a.toLowerCase(),
    right = b.toLowerCase();
  return (
    left !== right &&
    /^0x[\da-f]{40}$/.test(left) &&
    /^0x[\da-f]{40}$/.test(right) &&
    left.slice(0, 6) === right.slice(0, 6) &&
    left.slice(-4) === right.slice(-4)
  );
}
