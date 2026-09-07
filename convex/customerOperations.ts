import { v } from 'convex/values';
import { mutation, query, internalMutation, internalQuery } from './_generated/server';
import { requireOrgAccess, requireUser } from './lib/rbac';
import { decodeServiceRecord, readServiceRecord, restoreCustomerIntent } from '../shared/customerServiceRecord';
import { verifyCustomerQuote } from '../shared/customerPaidExecution';

export const current = query({
  args: { orgId: v.id('orgs'), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, ['admin']);
    return ctx.db.query('customerOperations').withIndex('by_owner_open', q => q.eq('orgId', args.orgId).eq('userId', user._id).eq('open', true)).first();
  },
});

// The same payer can own several organizations. Its token permit nonce is
// shared across them, so show a conflict before opening another wallet prompt.
export const conflict = query({
  args: { orgId: v.id('orgs'), chainId: v.number(), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, ['admin']);
    const previous = await ctx.db.query('customerOperations').withIndex('by_payer_state', q => q.eq('walletAddress', user.walletAddress.toLowerCase()).eq('chainId', args.chainId).eq('state', 'pending')).first();
    return previous && previous.orgId !== args.orgId && previous.userId === user._id ? { operationId: previous._id } : null;
  },
});

/** Written before any signed payload can leave the browser. The original hash
 * remains recoverable after a timeout, reload or another browser tab. */
export const begin = mutation({
  args: { orgId: v.id('orgs'), sessionToken: v.string(), record: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.orgId, args.sessionToken, ['admin']);
    const record = decodeServiceRecord(args.record);
    if (!record.account) throw new Error('Account details are missing from this setup request');
    if (record.intent.owner.toLowerCase() !== user.walletAddress.toLowerCase()) throw new Error('Use the wallet you signed in with');
    const existing = await ctx.db.query('customerOperations').withIndex('by_owner_open', q => q.eq('orgId', args.orgId).eq('userId', user._id).eq('open', true)).first();
    if (existing) {
      if (existing.hash === record.quote.hash) return existing._id;
      throw new Error('An earlier setup request is still unresolved. Check its status before starting another.');
    }
    const payer = user.walletAddress.toLowerCase();
    const otherRequest = await ctx.db.query('customerOperations').withIndex('by_payer_state', q => q.eq('walletAddress', payer).eq('chainId', record.intent.chainId).eq('state', 'pending')).first();
    if (otherRequest) throw new Error('Finish the earlier account setup for this wallet and network before starting another.');
    const verified = verifyCustomerQuote(record.quote, restoreCustomerIntent(record));
    return ctx.db.insert('customerOperations', { orgId: args.orgId, userId: user._id, walletAddress: payer, record: args.record, hash: record.quote.hash, chainId: record.intent.chainId, state: 'pending', open: true, fee: verified.fee.toString(), feePaid: false, createdAt: Date.now(), expiresAt: verified.expiresAt, scanFrom: record.startBlock });
  },
});

export const identity = internalQuery({
  args: { operationId: v.id('customerOperations'), sessionToken: v.string(), requireAdmin: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation) throw new Error('Execution request not found');
    // A payer can inspect its own already-authorized request after losing org
    // access. This permits settlement recovery, not a new payment or org write.
    const { user } = await requireUser(ctx, args.sessionToken);
    if (user._id !== operation.userId) throw new Error('Use the wallet that started this request');
    if (args.requireAdmin) await requireOrgAccess(ctx, operation.orgId, args.sessionToken, ['admin']);
    return operation;
  },
});

export const reconcile = internalMutation({
  args: { operationId: v.id('customerOperations'), state: v.union(v.literal('pending'), v.literal('confirmed'), v.literal('failed'), v.literal('expired')), feePaid: v.boolean(), feeTxHash: v.optional(v.string()), workTxHash: v.optional(v.string()), workSuccess: v.optional(v.boolean()), expectedScanFrom: v.string(), scanFrom: v.string() },
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.operationId);
    if (!op) throw new Error('Execution request not found');
    // An overlapping check cannot overwrite a newer scan or its settlement evidence.
    if (op.state !== 'pending' || op.scanFrom !== args.expectedScanFrom) return { state: op.state, feePaid: op.feePaid, workTxHash: op.workTxHash };
    await ctx.db.patch(op._id, { state: args.state, open: args.state === 'pending' || args.state === 'confirmed', feePaid: args.feePaid || op.feePaid, ...(args.feeTxHash ? { feeTxHash: args.feeTxHash } : {}), ...(args.workTxHash ? { workTxHash: args.workTxHash } : {}), ...(args.workSuccess !== undefined ? { workSuccess: args.workSuccess } : {}), scanFrom: args.scanFrom, checkedAt: Date.now() });
    return { state: args.state, feePaid: args.feePaid || op.feePaid, workTxHash: args.workTxHash ?? op.workTxHash };
  },
});

export const linkedAccount = internalQuery({
  args: { operationId: v.id('customerOperations') },
  handler: async (ctx, { operationId }) => {
    const op = await ctx.db.get(operationId);
    if (!op) return null;
    const account = readServiceRecord(op.record).account?.address;
    if (!account) return null;
    return ctx.db.query('safes').withIndex('by_org_chain_address', q => q.eq('orgId', op.orgId).eq('chainId', op.chainId).eq('safeAddress', account.toLowerCase())).first();
  },
});
export const finish = internalMutation({
  args: { operationId: v.id('customerOperations'), safeId: v.id('safes') },
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.operationId);
    if (!op || op.state !== 'confirmed') throw new Error('Account setup has not been confirmed');
    await ctx.db.patch(op._id, { open: false, safeId: args.safeId });
  },
});
