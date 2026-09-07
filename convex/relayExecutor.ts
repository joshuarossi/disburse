'use node';
import { readSettlementBlock } from './lib/settlementBlock';
import { assertFundingBalance } from './lib/fundingBalance';
import { allowanceTransferAbi, assertDelegatedReceipt } from '../shared/allowanceTransfer';
import { amountToBaseUnits } from './lib/validation';
import { v } from 'convex/values';
import { action, internalAction, type ActionCtx } from './_generated/server';
import { api, internal } from './_generated/api';
import type { ExecutionFee } from '../shared/executionFee';
import { feeIdentity } from '../shared/executionFee';
import type { Id } from './_generated/dataModel';
import { getSafeTxServiceUrl } from '../shared/safe';
import { assertSafeProposal, readOwnerApprovalStatus, type SafeProposal } from './lib/safeProposal';
import { encodeExecTransaction } from './lib/encodeSafeExecution';
import { loadPaymentProposal } from './lib/paymentProposal';
import { managedRelay } from './lib/managedRelay';
import { getChainClient } from './lib/safeVerification';
import { assertPaymentReceipt } from './lib/executionReceipt';
import { assertReceiptConfirmations } from '../shared/confirmations';
import { CHAIN_TOKENS, type SupportedChainId } from '../shared/chains';
import { matchesAccountExecution } from '../shared/accountExecution';

async function proposal(chainId: number, hash: string) {
  const response = await fetch(`${getSafeTxServiceUrl(chainId)}/v2/multisig-transactions/${hash}/`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Could not retrieve the account proposal. Please retry.');
  return await response.json() as SafeProposal & { isExecuted?: boolean; transactionHash?: string };
}
async function checkProvider(chainId: number, fee: ExecutionFee) {
  const relayer = managedRelay(chainId);
  let capabilities, balance;
  try { [capabilities, balance] = await Promise.all([relayer.getCapabilities(), relayer.getBalance()]); }
  catch { throw new Error('The managed payment service could not be reached. Please retry before signing.'); }
  const supported = capabilities[chainId];
  if (!supported || supported.feeCollector.toLowerCase() !== fee.collector.toLowerCase() || !supported.tokens.some(t => t.address.toLowerCase() === fee.tokenAddress.toLowerCase() && t.decimals === 6)) throw new Error('The payment service does not support this network and fee currency. Contact support.');
  if (balance.balance <= 0n) throw new Error('The managed payment service needs billing attention. Your payment has not been submitted.');
}
export const validateFee = internalAction({ args: { chainId: v.number(), fee: v.object({ token: v.string(), tokenAddress: v.string(), collector: v.string(), amount: v.string() }) }, handler: async (_ctx, args): Promise<void> => checkProvider(args.chainId, args.fee) });
export const checkFee = action({ args: { disbursementId: v.id('disbursements'), sessionToken: v.string(), reviewedIdentity: v.string() }, handler: async (ctx, args): Promise<void> => {
  const p = await ctx.runQuery(api.disbursements.get, { disbursementId: args.disbursementId, sessionToken: args.sessionToken });
  if (!p?.chainId || !p.executionFee || feeIdentity(p.executionFee) !== args.reviewedIdentity) throw new Error('Review the current payment fee before signing.');
  const account = await ctx.runQuery(internal.disbursements.getInternal, { disbursementId: args.disbursementId });
  if (!account?.safeAddress) throw new Error('Funding account not found');
  await assertFundingBalance(p.chainId, account.safeAddress, p.token, p.totalAmount ?? p.amount ?? '0', p.executionFee);
  await checkProvider(p.chainId, p.executionFee);
} });
async function prepare(ctx: ActionCtx, args: { disbursementId: Id<'disbursements'>; sessionToken?: string; scheduledVersion?: number }): Promise<Id<'relayJobs'>> {
  const expected = await ctx.runQuery(internal.disbursements.getForVerification, { disbursementId: args.disbursementId, sessionToken: args.sessionToken });
  if (!expected.executionFee) throw new Error('This proposal uses the retired payment service. Cancel it and prepare a new payment with a reviewed fee.');
  await checkProvider(expected.chainId, expected.executionFee);
  const tx = await loadPaymentProposal(ctx, args.disbursementId, expected);
  await assertSafeProposal(tx, expected, true);
  const verified = await readOwnerApprovalStatus(tx, expected.chainId, expected.safeAddress, expected.safeTxHash as `0x${string}`);
  const seen = new Set<string>();
  const confirmations = (tx.confirmations ?? []).filter(c => {
    const owner = c.owner.toLowerCase();
    if (!verified.confirmedOwners.includes(owner) || seen.has(owner)) return false;
    seen.add(owner); return true;
  });
  const block = await getChainClient(expected.chainId).getBlockNumber();
  return ctx.runMutation(internal.relayJobs.reserve, { ...args, searchFromBlock: String(block > 12n ? block - 12n : 0n), chainId: expected.chainId, safeTxHash: expected.safeTxHash, to: expected.safeAddress, data: encodeExecTransaction({ ...tx, data: tx.data ?? undefined, refundReceiver: tx.refundReceiver ?? undefined, confirmations }) });
}
export const submit = action({ args: { disbursementId: v.id('disbursements'), sessionToken: v.string() }, handler: (ctx, args): Promise<Id<'relayJobs'>> => prepare(ctx, args) });
export const fire = internalAction({ args: { disbursementId: v.id('disbursements'), scheduledVersion: v.number(), attempt: v.optional(v.number()) }, handler: async (ctx, args): Promise<void> => {
  const p = await ctx.runQuery(internal.disbursements.getInternal, { disbursementId: args.disbursementId });
  if (!p || p.status !== 'scheduled' || p.scheduledVersion !== args.scheduledVersion) return;
  try { await prepare(ctx, { disbursementId: args.disbursementId, scheduledVersion: args.scheduledVersion }); }
  catch {
    await ctx.runMutation(internal.relayJobs.deferScheduled, { ...args, attempt: args.attempt ?? 0 });
  }
} });
export const process = internalAction({ args: { jobId: v.id('relayJobs') }, handler: async (ctx, args): Promise<void> => {
  const job = await ctx.runQuery(internal.relayJobs.get, args);
  if (!job || job.status === 'confirmed' || job.status === 'exception') return;
  let submissionClaimed = false;
  try {
    if (job.status === 'prepared') {
      const relayer = managedRelay(job.chainId);
      if (!await ctx.runMutation(internal.relayJobs.begin, args)) return;
      submissionClaimed = true;
      // Disable transport and SDK retries: an interrupted response can already have been accepted.
      const providerId = await relayer.sendTransaction({ chainId: job.chainId, to: job.to as `0x${string}`, data: job.data as `0x${string}` }, { retries: { max: 0 } });
      await ctx.runMutation(internal.relayJobs.update, { ...args, status: 'submitted', providerId });
      return;
    }
    const payment = await ctx.runQuery(internal.disbursements.getInternal, { disbursementId: job.disbursementId });
    const allowance = payment?.allowanceExecution;
    let txHash = job.txHash;
    if (job.providerId) {
      // A provider outage must not block independent settlement verification.
      const status = await Promise.resolve().then(() => managedRelay(job.chainId).getStatus({ id: job.providerId! })).catch(() => null);
      if (status && status.chainId !== job.chainId) throw new Error('Payment provider returned another network');
      if (status && 'receipt' in status) txHash = 'transactionHash' in status.receipt ? status.receipt.transactionHash : status.receipt.receipt.transactionHash;
      else if (status && 'hash' in status) txHash = status.hash;
      if (status && [400, 500].includes(status.status) && !txHash) {
        await ctx.runMutation(internal.relayJobs.update, { ...args, status: 'exception', error: 'The payment service rejected this submission. Review the original payment before retrying.' });
        return;
      }
    }
    if (!txHash && allowance && job.searchFromBlock) {
      const client = getChainClient(job.chainId);
      const fromBlock = BigInt(job.searchFromBlock);
      const head = await client.getBlockNumber();
      const toBlock = head < fromBlock + 1999n ? head : fromBlock + 1999n;
      if (fromBlock <= toBlock) {
        const logs = await client.getContractEvents({ address: allowance.module as `0x${string}`, abi: allowanceTransferAbi, eventName: 'ExecuteAllowanceTransfer', args: { safe: allowance.safeAddress as `0x${string}` }, fromBlock, toBlock });
        const match = logs.find(l => l.args.delegate?.toLowerCase() === allowance.delegate.toLowerCase() && l.args.token?.toLowerCase() === allowance.tokenAddress.toLowerCase() && l.args.to?.toLowerCase() === allowance.recipientAddress.toLowerCase() && l.args.nonce === allowance.nonce && l.args.value === amountToBaseUnits(allowance.amount, payment!.token));
        if (match) txHash = match.transactionHash;
        else if (toBlock > fromBlock) await ctx.runMutation(internal.relayJobs.update, { ...args, status: 'submitted', searchFromBlock: String(toBlock) });
      }
    } else if (!txHash && !allowance) {
      // The approval store does not depend on Safe's transaction service. Find
      // the original execution directly even if the provider lost its response.
      if (job.searchFromBlock) {
        const client = getChainClient(job.chainId);
        const head = await client.getBlockNumber();
        const fromBlock = BigInt(job.searchFromBlock), confirmed = head > 1n ? head - 1n : 0n;
        const toBlock = confirmed < fromBlock + 1999n ? confirmed : fromBlock + 1999n;
        if (fromBlock <= toBlock) {
          const logs = await client.getLogs({ address: job.to as `0x${string}`, fromBlock, toBlock });
          txHash = logs.find(l => matchesAccountExecution(l, job.safeTxHash))?.transactionHash ?? undefined;
          if (!txHash && toBlock > fromBlock + 12n) await ctx.runMutation(internal.relayJobs.update, { ...args, status: 'submitted', searchFromBlock: String(toBlock - 12n) });
        }
      } else {
        const tx = await proposal(job.chainId, job.safeTxHash);
        if (tx.isExecuted && tx.transactionHash) txHash = tx.transactionHash;
      }
    }
    await ctx.runMutation(internal.relayJobs.update, { ...args, status: 'submitted', txHash });
    if (!txHash) return;
    if (allowance) {
      const client = getChainClient(job.chainId);
      const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
      if (receipt.status !== 'success') {
        await ctx.runMutation(internal.relayJobs.update, { ...args, status: 'exception', txHash, error: 'The relayed payment reverted. Neither the recipient payment nor its fee settled.' });
        return;
      }
      assertDelegatedReceipt(receipt, allowance.safeAddress, payment!.token, allowance);
      assertReceiptConfirmations(receipt.blockNumber, await client.getBlockNumber());
      await ctx.runMutation(internal.delegatedPayments.confirm, { disbursementId: job.disbursementId, txHash, hash: allowance.hash, settlement: await readSettlementBlock(client, job.chainId, receipt) });
      await ctx.runMutation(internal.relayJobs.update, { ...args, status: 'confirmed', txHash });
      return;
    }
    const expected = await ctx.runQuery(internal.disbursements.getForVerification, { disbursementId: job.disbursementId });
    const token = Object.entries(CHAIN_TOKENS[job.chainId as SupportedChainId] ?? {}).find(([symbol]) => symbol === expected.token)?.[1];
    if (!token) throw new Error('Unsupported payment currency');
    const client = getChainClient(job.chainId);
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (receipt.status !== 'success') {
      await ctx.runMutation(internal.relayJobs.update, { ...args, status: 'exception', txHash, error: 'The transaction reverted. No payment was confirmed.' }); return;
    }
    assertPaymentReceipt(receipt, { ...expected, tokenAddress: token.address });
    assertReceiptConfirmations(receipt.blockNumber, await client.getBlockNumber());
    await ctx.runMutation(internal.disbursements.confirmExecution, { disbursementId: job.disbursementId, txHash, safeTxHash: job.safeTxHash, settlement: await readSettlementBlock(client, job.chainId, receipt) });
    await ctx.runMutation(internal.relayJobs.update, { ...args, status: 'confirmed', txHash });
  } catch {
    if (job.status === 'prepared' && !submissionClaimed) {
      await ctx.runMutation(internal.relayJobs.deferPreparation, args);
      return;
    }
    // Provider errors can contain authenticated URLs. Keep secrets out of logs and public records.
    await ctx.runMutation(internal.relayJobs.update, { ...args, status: 'submitted', error: 'Confirmation is pending. We are checking the original submission; do not create a replacement payment.' });
  }
} });
