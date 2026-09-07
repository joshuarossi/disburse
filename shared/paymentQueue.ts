type QueuePayment = {
  status: string;
  cancellationId?: string;
  cancellationConfirmedAt?: number;
  scheduledAt?: number;
  relayStatus?: string;
  txHash?: string;
  nativeExecution?: { walletRejectedAt?: number; revertedAt?: number };
  executionFailure?: { safeTxHash: string; txHash: string };
};

export function walletSendDeclined(payment: QueuePayment) {
  return payment.status === 'relaying' && !!payment.nativeExecution?.walletRejectedAt && !payment.txHash;
}

export function submissionNeedsAttention(payment: QueuePayment) {
  return payment.status === 'relaying' && (walletSendDeclined(payment) || !!payment.nativeExecution?.revertedAt || ['Needs investigation', 'Payment review required'].includes(payment.relayStatus ?? ''));
}

export function paymentStatus(payment: QueuePayment) {
  if (payment.status === 'failed' && payment.executionFailure) return { status: 'failed', label: 'Payment failed' };
  if (payment.cancellationId && !payment.cancellationConfirmedAt && !['executed', 'failed'].includes(payment.status)) return { status: 'pending', label: 'Cancellation pending' };
  return { status: submissionNeedsAttention(payment) ? 'failed' : payment.status, label: walletSendDeclined(payment) || payment.nativeExecution?.revertedAt ? 'Ready to retry' : undefined };
}

export function isUpcomingPayment(payment: QueuePayment, now: number) {
  return (
    !payment.cancellationId &&
    payment.scheduledAt !== undefined &&
    payment.scheduledAt > now &&
    ["draft", "pending", "proposed", "scheduled"].includes(payment.status)
  );
}

export function isOverdueScheduledPayment(payment: QueuePayment, now: number) {
  return (
    !payment.cancellationId &&
    ["draft", "pending", "proposed", "scheduled"].includes(payment.status) &&
    payment.scheduledAt !== undefined &&
    payment.scheduledAt <= now
  );
}

export function paymentException(
  payment: QueuePayment,
  now: number,
): string | null {
  if (payment.cancellationId && !payment.cancellationConfirmedAt && !['executed', 'failed'].includes(payment.status)) return 'Cancellation awaiting confirmation';
  if (payment.status === "failed") return "Payment failed";
  if (payment.status === 'relaying' && payment.nativeExecution?.revertedAt && !payment.txHash) return 'Transaction reverted';
  if (walletSendDeclined(payment)) return 'Wallet approval declined';
  if (payment.status === 'relaying' && payment.relayStatus === 'Payment review required') return 'Recipient review required';
  if (
    payment.status === "relaying" &&
    payment.relayStatus === "Needs investigation"
  )
    return "Settlement needs checking";
  if (isOverdueScheduledPayment(payment, now))
    return payment.status === "scheduled"
      ? "Payment is past its pay date"
      : "Approval deadline missed";
  return null;
}
