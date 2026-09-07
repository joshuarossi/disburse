/** Funded Sepolia acceptance for signed, replay-safe delegated payments. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ConvexHttpClient } from 'convex/browser';
import { createPublicClient, createWalletClient, http, encodeFunctionData, zeroAddress, erc20Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { api } from '../convex/_generated/api.js';
import { allowanceDeployments as getAllowanceDeployments } from '../shared/allowanceDeployments.ts';
import { approvalSigningData } from '../shared/safeSignatures.ts';
import { allowanceTransferAbi } from '../shared/allowanceTransfer.ts';
import { CHAIN_TOKENS } from '../shared/chains.ts';
if (!process.env.CONVEX_DEPLOYMENT?.startsWith('dev:')) throw new Error('Development backend only');
const dir = '.local/qa';
const baseline = JSON.parse(readFileSync(`${dir}/testnet-report.json`));
const workspace = JSON.parse(readFileSync(`${dir}/workspace-report.json`));
const { privateKey } = JSON.parse(readFileSync(`${dir}/wallet.json`));
const owner = privateKeyToAccount(privateKey);
const delegate = privateKeyToAccount(JSON.parse(readFileSync(`${dir}/recipients.json`))[1]);
if (baseline.chainId !== 11155111 || baseline.wallet !== owner.address || workspace.deployment !== process.env.CONVEX_DEPLOYMENT) throw new Error('Wrong isolated QA state');
const rpc = process.env.QA_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const chain = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 20000 }) });
if (await chain.getChainId() !== 11155111) throw new Error('Sepolia only');
const sender = createWalletClient({ chain: sepolia, transport: http(rpc), account: owner });
const delegateWallet = createWalletClient({ chain: sepolia, transport: http(rpc), account: delegate });
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: false });
const module = getAllowanceDeployments(11155111)[0];
const token = CHAIN_TOKENS[11155111].USDC.address;
const path = `${dir}/delegated-workspace-report.json`;
const report = existsSync(path) ? JSON.parse(readFileSync(path)) : { safe: baseline.safe, orgId: workspace.orgId, delegate: delegate.address, checks: [], transactions: [] };
if (report.safe !== baseline.safe || report.delegate !== delegate.address) throw new Error('Wrong QA report');
if (report.complete) { console.log('Delegated workspace acceptance already completed; no new transfers sent'); process.exit(0); }
const save = () => writeFileSync(path, JSON.stringify(report, null, 2), { mode: 0o600 });
const pass = name => { if (!report.checks.includes(name)) report.checks.push(name); save(); console.log(`PASS ${name}`); };
async function login(account) {
  const { message } = await client.mutation(api.auth.generateNonce, { walletAddress: account.address });
  const { token } = await client.mutation(api.auth.verifySignature, { walletAddress: account.address, message, signature: await account.signMessage({ message }) });
  return token;
}
async function send(label, tx, wallet = sender) {
  let record = report.transactions.find(tx => tx.label === label);
  if (!record) { record = { label, hash: await wallet.sendTransaction({ ...tx, value: BigInt(tx.value || 0) }) }; report.transactions.push(record); save(); }
  const receipt = await chain.waitForTransactionReceipt({ hash: record.hash, confirmations: 2, timeout: 180000 });
  if (receipt.status !== 'success') throw new Error(`${label} reverted`);
  record.status = 'success'; save(); console.log(`${label}: ${record.hash}`); return record.hash;
}
async function policy(label, kind) {
  report.policyRequests ??= {};
  if (!report.policyRequests[label]) {
    if (report.prepared?.[label]) throw new Error('This QA run has an earlier signed policy. Preserve and inspect that evidence before starting another run.');
    const safeId = (await client.query(api.safes.getForOrg, { orgId: workspace.orgId, sessionToken })).find(s => s.chainId === 11155111 && s.safeAddress.toLowerCase() === baseline.safe.toLowerCase())?._id;
    if (!safeId) throw new Error('Isolated QA account is not linked');
    const policyChangeId = await client.action(api.spendingPolicies.create, { safeId, sessionToken, requestId: crypto.randomUUID(), kind, module: module.address, delegate: delegate.address, ...(kind === 'grant' ? { token: 'USDC', amount: '0.1', resetMinutes: 0 } : { tokenAddress: token }) });
    report.policyRequests[label] = { policyChangeId }; save();
  }
  const entry = report.policyRequests[label], identity = { policyChangeId: entry.policyChangeId, sessionToken };
  if (!entry.approved) {
    const view = await client.action(api.spendingPolicies.approvals, identity);
    const path = view.paths[0].path;
    const signature = await owner.sign({ hash: approvalSigningData(11155111, path, view.proposal.safeTransactionData).hash });
    await client.action(api.spendingPolicies.approve, { ...identity, path, signature, safeTxHash: view.proposal.safeTxHash });
    entry.approved = true; save();
  }
  if (!entry.execution) { entry.execution = await client.action(api.spendingPolicies.execute, identity); save(); }
  if (entry.execution.managed) throw new Error('This test requires native Sepolia execution');
  const txHash = await send(label, { to: entry.execution.to, data: entry.execution.data });
  await client.mutation(api.spendingPolicyData.recordBroadcast, { ...identity, attemptId: entry.execution.attemptId, txHash });
  pass(`Persisted account approvals authorize ${label}`);
}
const sessionToken = await login(owner);
const delegateSession = await login(delegate);
try {
  const scope = { orgId: workspace.orgId, sessionToken };
  const members = await client.query(api.orgs.listMembers, scope);
  if (!members.some(member => member.walletAddress.toLowerCase() === delegate.address.toLowerCase())) await client.mutation(api.orgs.inviteMember, { ...scope, memberWalletAddress: delegate.address, memberName: 'QA Delegated payer', role: 'initiator' });
  await client.mutation(api.orgs.acceptInvite, { orgId: workspace.orgId, sessionToken: delegateSession });
  pass('Delegate accepts a real workspace invitation');
  if (!report.invoiceId) {
    report.invoiceId = await client.mutation(api.invoices.create, { ...scope, beneficiaryId: workspace.beneficiaryIds[0], invoiceNumber: 'QA-DELEGATED-0001', amount: '0.010001', token: 'USDC', dueDate: Date.now() + 86400000 }); save();
  }
  if (!report.disbursementId) { report.disbursementId = (await client.mutation(api.invoices.preparePayment, { ...scope, invoiceIds: [report.invoiceId], chainId: 11155111 })).disbursementId; save(); }
  const args = { disbursementId: report.disbursementId, sessionToken: delegateSession };
  if (!report.revoking) {
    await policy('Grant test delegated allowance', 'grant');
    if (!report.intent) {
      const quote = await client.action(api.delegatedPayments.quote, args);
      const signature = await delegate.signMessage({ message: { raw: quote.hash } });
      report.intent = await client.action(api.delegatedPayments.prepare, { ...args, hash: quote.hash, signature });
      report.before = String(await chain.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] })); save();
      pass('Backend verifies and reserves the signed allowance authorization');
    }
    const intent = report.intent;
    const call = { address: intent.module, abi: allowanceTransferAbi, functionName: 'executeAllowanceTransfer', args: [intent.safeAddress, intent.tokenAddress, intent.recipientAddress, 10001n, zeroAddress, 0n, intent.delegate, intent.signature], account: delegate };
    const txHash = await send('Delegate invoice payment', { to: intent.module, data: encodeFunctionData(call) }, delegateWallet);
    await client.action(api.delegatedPayments.recordSubmission, { ...args, txHash });
    let payment;
    for (let attempt = 0; attempt < 20; attempt++) {
      payment = await client.query(api.disbursements.getWithRecipients, args);
      if (payment.status === 'executed') break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (payment?.status !== 'executed' || payment.txHash !== txHash) throw new Error('Delegated settlement was not reconciled');
    pass('Backend reconciles delegated settlement without a Safe owner proposal');
    const after = await chain.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] });
    if (after - BigInt(report.before) !== 10001n) throw new Error('Wrong delegated recipient balance');
    pass('Recipient receives exactly 0.010001 USDC');
    const invoices = await client.query(api.invoices.list, scope);
    if (invoices.find(invoice => invoice._id === report.invoiceId)?.status !== 'paid') throw new Error('Linked invoice did not become paid');
    pass('Linked invoice reconciles as paid');
    let reverted = false;
    try { await chain.simulateContract(call); } catch (error) { if (!String(error).includes('revert')) throw error; reverted = true; }
    if (!reverted) throw new Error('Signed authorization replay unexpectedly succeeded');
    pass('Replaying the signed payment is rejected on chain');
    report.revoking = true; save();
  }
  await policy('Revoke test delegated allowance', 'revoke');
  pass('Test grant revoked after acceptance');
  report.complete = true; report.checkedAt = new Date().toISOString(); save();
} finally {
  await client.mutation(api.auth.logout, { token: sessionToken });
  await client.mutation(api.auth.logout, { token: delegateSession });
}
