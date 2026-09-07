import { v } from 'convex/values';
import { action, internalMutation, internalQuery } from './_generated/server';
import { api, internal } from './_generated/api';
import { verificationContext } from './disbursements';
import { requireOrgAccess } from './lib/rbac';
import { assertMemberPaymentPolicy } from './lib/paymentLimits';
import { assertPaymentMayProceed } from './lib/disbursementPolicy';
import { ownerProposalValidator } from './lib/ownerProposalValidator';
import { approvalPaths, readAccountAuthority } from './lib/accountAuthority';
import { prepareAccountTransaction, verifyAccountSignature } from './lib/accountApproval';
import { approvalSigningData } from '../shared/safeSignatures';
import { assertSafeProposal, readOwnerApprovalStatus } from './lib/safeProposal';
import { encodeExecTransaction } from './lib/encodeSafeExecution';
import { loadPaymentProposal } from './lib/paymentProposal';
import { appendAudit } from './audit';
import type { PreparedOwnerProposal } from '../shared/ownerProposal';

const identity = { disbursementId: v.id('disbursements'), sessionToken: v.string() };
const signed = { ...identity, proposal: ownerProposalValidator, path: v.array(v.string()), signature: v.string() };
const emptyHash = `0x${'00'.repeat(32)}`;
export const context = internalQuery({
  args: { disbursementId: v.id('disbursements'), sessionToken: v.optional(v.string()), readOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const expected = await verificationContext(ctx, { ...args, candidateHash: (await ctx.db.get(args.disbursementId))?.safeTxHash ?? emptyHash });
    const payment = (await ctx.db.get(args.disbursementId))!;
    const saved = await ctx.db.query('accountProposals').withIndex('by_payment', q => q.eq('disbursementId', payment._id)).unique();
    const original = await ctx.db.query('ownerProposals').withIndex('by_payment', q => q.eq('disbursementId', payment._id)).unique();
    const signatures = await ctx.db.query('accountSignatures').withIndex('by_payment', q => q.eq('disbursementId', payment._id)).take(501);
    const accountKey = `${expected.chainId}:${expected.safeAddress.toLowerCase()}`;
    const latest = await ctx.db.query('accountProposals').withIndex('by_account_nonce', q => q.eq('accountKey', accountKey)).order('desc').first();
    const accounts = await ctx.db.query('safes').withIndex('by_org', q => q.eq('orgId', payment.orgId)).collect();
    return { expected, payment, saved, original, signatures, accountKey, latestNonce: latest?.nonce ?? -1, accountNames: accounts.filter(a => a.chainId === expected.chainId).map(a => ({ address: a.safeAddress.toLowerCase(), name: a.name ?? 'Company account' })) };
  },
});

// Recover an already-signed payment into the current approval store. This is
// read-only at Safe's service: no replacement nonce, payload or remote POST.
export const recoverOriginal = action({
  args: identity,
  handler: async (ctx, args): Promise<string> => {
    const source = await ctx.runQuery(internal.accountApprovals.context, args);
    if (source.saved) return source.saved.proposal.safeTxHash;
    if (!source.payment.safeTxHash || !['pending', 'proposed', 'scheduled'].includes(source.payment.status)) throw new Error('No original approval is available for recovery');
    const original = source.original?.proposal;
    const tx = original ? { ...original.safeTransactionData, safe: original.safeAddress, confirmations: [{ owner: original.senderAddress, signature: original.senderSignature }] } : await loadPaymentProposal(ctx, args.disbursementId, source.expected);
    await assertSafeProposal(tx, source.expected, false);
    const approvals = await readOwnerApprovalStatus(tx, source.expected.chainId, source.expected.safeAddress, source.payment.safeTxHash as `0x${string}`);
    if (approvals.currentNonce > approvals.proposalNonce) throw new Error('Check settlement of the original transaction before recovering its approvals');
    const signatures = (tx.confirmations ?? []).filter(s => !s.isContractSignature && approvals.confirmedOwners.includes(s.owner.toLowerCase()));
    const proposal: PreparedOwnerProposal = { safeAddress: tx.safe, safeTxHash: source.payment.safeTxHash, senderAddress: source.expected.actorWallet!, senderSignature: signatures[0]?.signature ?? '0x', safeTransactionData: { to: tx.to, value: tx.value, data: tx.data ?? '0x', operation: tx.operation as 0 | 1, safeTxGas: String(tx.safeTxGas), baseGas: String(tx.baseGas), gasPrice: tx.gasPrice, gasToken: tx.gasToken, refundReceiver: tx.refundReceiver ?? '0x0000000000000000000000000000000000000000', nonce: Number(tx.nonce) } };
    return ctx.runMutation(internal.accountApprovals.importOriginal, { ...args, proposal, signatures, snapshot: source.expected.snapshot });
  },
});
export const importOriginal = internalMutation({
  args: { ...identity, proposal: ownerProposalValidator, signatures: v.array(v.object({ owner: v.string(), signature: v.string(), isContractSignature: v.optional(v.boolean()) })), snapshot: v.string() },
  handler: async (ctx, args) => {
    const current = await verificationContext(ctx, args);
    const payment = (await ctx.db.get(args.disbursementId))!;
    const { user } = await requireOrgAccess(ctx, payment.orgId, args.sessionToken, ['admin', 'approver', 'initiator']);
    await assertPaymentMayProceed(ctx, payment);
    const existing = await ctx.db.query('accountProposals').withIndex('by_payment', q => q.eq('disbursementId', payment._id)).unique();
    if (existing) return existing.proposal.safeTxHash;
    if (current.snapshot !== args.snapshot || args.proposal.safeTxHash !== payment.safeTxHash) throw new Error('The original payment changed during recovery');
    const path = [current.safeAddress.toLowerCase()];
    const accountKey = `${current.chainId}:${path[0]}`;
    const conflict = await ctx.db.query('accountProposals').withIndex('by_account_nonce', q => q.eq('accountKey', accountKey).eq('nonce', args.proposal.safeTransactionData.nonce)).first();
    if (conflict) throw new Error('Another saved payment uses this account transaction number');
    await ctx.db.insert('accountProposals', { disbursementId: payment._id, accountKey, nonce: args.proposal.safeTransactionData.nonce, proposal: args.proposal, createdAt: Date.now() });
    const seen = new Set<string>();
    for (const s of args.signatures) {
      const owner = s.owner.toLowerCase();
      if (seen.has(owner)) continue;
      seen.add(owner);
      await ctx.db.insert('accountSignatures', { disbursementId: payment._id, path, pathKey: path[0], owner, signature: s.signature, digest: payment.safeTxHash!, actorUserId: user._id, createdAt: Date.now() });
    }
    await ctx.db.patch(payment._id, { approvalMethod: 'workspace', preparedProposalAt: payment.preparedProposalAt ?? Date.now(), updatedAt: Date.now() });
    await appendAudit(ctx, { orgId: payment.orgId, actorUserId: user._id, action: 'disbursement.approvals_recovered', objectType: 'disbursement', objectId: payment._id, metadata: { safeTxHash: payment.safeTxHash, signatures: seen.size } });
    return args.proposal.safeTxHash;
  },
});

type SigningRequest = { proposal: PreparedOwnerProposal; paths: Array<{ path: string[]; labels: string[]; approved: boolean }>; blockNumber: string };
export const forSigning = action({
  args: identity,
  handler: async (ctx, args): Promise<SigningRequest> => {
    await ctx.runQuery(api.recipientReviews.assertPayable, args);
    const source = await ctx.runQuery(internal.accountApprovals.context, args);
    if (!['draft', 'pending', 'proposed', 'scheduled'].includes(source.payment.status) || source.payment.allowanceExecution) throw new Error('This payment cannot accept approvals');
    if (source.payment.safeTxHash && !source.saved) throw new Error('Resume this payment through its original approval flow');
    const authority = await readAccountAuthority(source.expected.chainId, source.expected.safeAddress);
    const root = authority.nodes[0];
    const nonce = Math.max(root.nonce, source.latestNonce + 1);
    const tx = source.saved?.proposal.safeTransactionData ?? prepareAccountTransaction(source.expected, nonce);
    const proposal = source.saved?.proposal ?? {
      safeAddress: source.expected.safeAddress, safeTxHash: approvalSigningData(source.expected.chainId, [authority.root], tx).hash,
      safeTransactionData: tx, senderAddress: source.expected.actorWallet!, senderSignature: '0x',
    };
    if (root.nonce > tx.nonce) throw new Error('This account transaction number has already been used. Check the original payment settlement.');
    await assertSafeProposal({ ...tx, safe: proposal.safeAddress }, { ...source.expected, safeTxHash: proposal.safeTxHash }, false);
    const paths = approvalPaths(authority, source.expected.actorWallet!).map(path => ({
      path, labels: path.map(a => source.accountNames.find(n => n.address === a)?.name ?? `${a.slice(0, 8)}…${a.slice(-6)}`),
      approved: source.signatures.some(s => s.owner === source.expected.actorWallet!.toLowerCase() && s.pathKey === path.join(':')),
    }));
    if (!paths.length) throw new Error('Your wallet is not a current approver for this account or its owning accounts');
    return { proposal, paths, blockNumber: authority.blockNumber };
  },
});
export const save = action({
  args: signed,
  handler: async (ctx, args): Promise<string> => {
    const source = await ctx.runQuery(internal.accountApprovals.context, { disbursementId: args.disbursementId, sessionToken: args.sessionToken });
    const expected = source.expected;
    if (source.saved && source.saved.proposal.safeTxHash.toLowerCase() !== args.proposal.safeTxHash.toLowerCase()) throw new Error('Resume the original saved payment');
    const authority = await readAccountAuthority(expected.chainId, expected.safeAddress);
    if (authority.nodes[0].nonce > args.proposal.safeTransactionData.nonce) throw new Error('This account transaction number has already been used');
    if (!source.saved && args.proposal.safeTransactionData.nonce !== Math.max(authority.nodes[0].nonce, source.latestNonce + 1)) throw new Error('The account queue changed. Review the payment again before signing.');
    await assertSafeProposal({ ...args.proposal.safeTransactionData, safe: args.proposal.safeAddress }, { ...expected, safeTxHash: args.proposal.safeTxHash }, false);
    const digest = await verifyAccountSignature(expected.chainId, authority, args.proposal, { path: args.path, owner: expected.actorWallet!, signature: args.signature });
    return ctx.runMutation(internal.accountApprovals.persist, { ...args, digest, snapshot: expected.snapshot });
  },
});
export const persist = internalMutation({
  args: { ...signed, digest: v.string(), snapshot: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.disbursementId);
    if (!payment) throw new Error('Payment not found');
    const { user } = await requireOrgAccess(ctx, payment.orgId, args.sessionToken, ['admin', 'approver', 'initiator']);
    if (!['draft', 'pending', 'proposed', 'scheduled'].includes(payment.status) || payment.allowanceExecution) throw new Error('This payment cannot accept approvals');
    const safe = await ctx.db.get(payment.safeId);
    if (!safe || safe.isActive === false) throw new Error('The funding account is no longer active');
    await assertPaymentMayProceed(ctx, payment);
    await assertMemberPaymentPolicy(ctx, payment.orgId, payment.createdBy, payment.token, payment.totalAmount ?? payment.amount ?? '0', payment.scheduledAt ?? payment.createdAt, payment._id);
    const existing = await ctx.db.query('accountProposals').withIndex('by_payment', q => q.eq('disbursementId', payment._id)).unique();
    const owner = user.walletAddress.toLowerCase(), path = args.path.map(a => a.toLowerCase()), pathKey = path.join(':');
    const original = await ctx.db.query('accountSignatures').withIndex('by_payment_signer', q => q.eq('disbursementId', payment._id).eq('pathKey', pathKey).eq('owner', owner)).unique();
    if (original && existing?.proposal.safeTxHash.toLowerCase() === args.proposal.safeTxHash.toLowerCase() && original.digest === args.digest) return existing.proposal.safeTxHash;
    const current = await verificationContext(ctx, { ...args, candidateHash: args.proposal.safeTxHash });
    if (current.snapshot !== args.snapshot) throw new Error('Payment details changed during approval. Review again.');
    if (existing && existing.proposal.safeTxHash.toLowerCase() !== args.proposal.safeTxHash.toLowerCase()) throw new Error('The original payment approval cannot be replaced');
    if (!existing) {
      if (payment.safeTxHash) throw new Error('This payment already has a saved proposal');
      const accountKey = `${safe.chainId}:${safe.safeAddress.toLowerCase()}`;
      const conflict = await ctx.db.query('accountProposals').withIndex('by_account_nonce', q => q.eq('accountKey', accountKey).eq('nonce', args.proposal.safeTransactionData.nonce)).first();
      if (conflict) throw new Error('Another payment reserved this account transaction number. Review again.');
      await ctx.db.insert('accountProposals', { disbursementId: payment._id, accountKey, nonce: args.proposal.safeTransactionData.nonce, proposal: { ...args.proposal, senderAddress: owner, senderSignature: args.signature }, createdAt: Date.now() });
      await ctx.db.patch(payment._id, { approvalMethod: 'workspace', safeTxHash: args.proposal.safeTxHash, preparedProposalAt: Date.now(), status: 'pending', updatedAt: Date.now() });
    }
    if ((await ctx.db.query('accountSignatures').withIndex('by_payment', q => q.eq('disbursementId', payment._id)).take(501)).length >= 500) throw new Error('This payment has reached its approval evidence limit');
    await ctx.db.insert('accountSignatures', { disbursementId: payment._id, pathKey, path, owner, signature: args.signature, digest: args.digest, actorUserId: user._id, createdAt: Date.now() });
    await appendAudit(ctx, { orgId: payment.orgId, actorUserId: user._id, action: 'disbursement.account_approval', objectType: 'disbursement', objectId: payment._id, metadata: { safeTxHash: args.proposal.safeTxHash, path, digest: args.digest } });
    return args.proposal.safeTxHash;
  },
});

export const execution = action({
  args: identity,
  handler: async (ctx, args): Promise<{ to: string; data: string }> => {
    await ctx.runQuery(api.recipientReviews.assertPayable, args);
    const expected = await ctx.runQuery(internal.disbursements.getForVerification, args);
    const proposal = await loadPaymentProposal(ctx, args.disbursementId, expected);
    await assertSafeProposal(proposal, expected, true);
    return { to: expected.safeAddress, data: encodeExecTransaction({ ...proposal, data: proposal.data ?? undefined, refundReceiver: proposal.refundReceiver ?? undefined }) };
  },
});
