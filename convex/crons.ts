import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
const crons = cronJobs();
crons.interval('Continue finance report indexing', { minutes: 1 }, internal.reportIndex.recover, {});
crons.interval('Remove abandoned invoice source uploads', { minutes: 15 }, internal.invoiceFiles.prune, {});
crons.interval('Check payment deadlines and reminders', { minutes: 1 }, internal.paymentFollowups.due, {});
crons.interval('Recover invitation email delivery', { minutes: 1 }, internal.emailDeliveryData.recover, {});
crons.interval('Refresh the OFAC SDN snapshot', { hours: 6 }, internal.ofac.refresh, {});
crons.interval('Refresh recipient screening', { minutes: 1 }, internal.screeningQueue.due, {});
crons.interval('Prune replaced OFAC search snapshots', { hours: 12 }, internal.ofacRetention.prune, {});
crons.interval('Recover managed payment submissions', { minutes: 1 }, internal.relayJobs.recover, {});
crons.interval('Recover native wallet payments', { minutes: 1 }, internal.nativePayments.recover, {});
crons.interval('Recover account policy changes', { minutes: 1 }, internal.spendingPolicyData.recover, {});
crons.interval('Continue deposit history synchronization', { minutes: 1 }, internal.depositsData.recover, {});
crons.interval('Track incoming invoice payments', { minutes: 1 }, internal.receivables.monitor, {});
crons.interval('Recover account cancellations', { minutes: 1 }, internal.accountCancellationData.recover, {});
crons.interval('recover subscription checkout', { minutes: 1 }, internal.billingCheckoutData.recover);

export default crons;
