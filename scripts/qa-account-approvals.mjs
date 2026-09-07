/** Sepolia acceptance for a two-owner Treasury controlling a separate Payroll account. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ConvexHttpClient } from 'convex/browser';
import Safe from '@safe-global/protocol-kit';
import { createPublicClient, createWalletClient, http, erc20Abi, encodeFunctionData, keccak256, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { api } from '../convex/_generated/api.js';
import { approvalSigningData } from '../shared/safeSignatures.ts';
import { CHAIN_TOKENS } from '../shared/chains.ts';
if (process.env.CONVEX_DEPLOYMENT !== 'dev:fortunate-cat-122') throw new Error('Isolated development deployment only');
const dir = '.local/qa';
const workspace = JSON.parse(readFileSync(`${dir}/workspace-report.json`));
const key = JSON.parse(readFileSync(`${dir}/wallet.json`)).privateKey;
const secondKey = JSON.parse(readFileSync(`${dir}/recipients.json`))[1];
const owner = privateKeyToAccount(key), second = privateKeyToAccount(secondKey);
if (workspace.wallet !== owner.address || workspace.orgId !== 'k575vpg8mtsn2126zbswdg4rfd8dvk88') throw new Error('Unexpected QA identity');
const file = `${dir}/account-approvals-evidence.json`;
const report = existsSync(file) ? JSON.parse(readFileSync(file)) : { orgId: workspace.orgId, wallet: owner.address, chainId: 11155111, transactions: [], checks: [] };
if (report.orgId !== workspace.orgId || report.wallet !== owner.address || report.chainId !== 11155111) throw new Error('Unexpected acceptance report');
const save = () => writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
const pass = name => { if (!report.checks.includes(name)) report.checks.push(name); save(); console.log(`PASS ${name}`); };
if (report.complete) { console.log('Nested payment acceptance already complete; no transaction repeated'); process.exit(0); }
const rpc = process.env.QA_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const chain = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 20000, retryCount: 1 }) });
const wallet = createWalletClient({ chain: sepolia, transport: http(rpc), account: owner });
assert.equal(await chain.getChainId(), 11155111);
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: false });
// Persist the signed transaction and known hash before sending. Retries can only
// rebroadcast identical bytes; a lost response never chooses a new nonce.
async function send(label, tx) {
  let sent = report.transactions.find(t => t.label === label);
  if (!sent) {
    const request = await wallet.prepareTransactionRequest({ ...tx, account: owner });
    const raw = await owner.signTransaction(request);
    sent = { label, hash: keccak256(raw), raw }; report.transactions.push(sent); save();
  }
  const existing = await chain.getTransactionReceipt({ hash: sent.hash }).catch(() => null);
  if (!existing) await chain.sendRawTransaction({ serializedTransaction: sent.raw }).catch(error => { if (!/already known|nonce too low|known transaction/i.test(String(error))) throw error; });
  const receipt = await chain.waitForTransactionReceipt({ hash: sent.hash, confirmations: 2, timeout: 180000 });
  assert.equal(receipt.status, 'success', `${label} reverted`);
  sent.gasUsed = receipt.gasUsed.toString(); sent.blockNumber = receipt.blockNumber.toString(); save();
  console.log(`${label}: ${sent.hash}`);
  return sent.hash;
}
async function deploy(label, owners, threshold, saltNonce) {
  const sdk = await Safe.init({ provider: rpc, signer: key, predictedSafe: { safeAccountConfig: { owners, threshold }, safeDeploymentConfig: { saltNonce, safeVersion: '1.4.1' } } });
  const address = await sdk.getAddress();
  if (!await chain.getCode({ address })) {
    const tx = await sdk.createSafeDeploymentTransaction();
    await send(label, { to: tx.to, data: tx.data, value: BigInt(tx.value || '0') });
  }
  return address;
}
async function login(account) {
  const { message } = await client.mutation(api.auth.generateNonce, { walletAddress: account.address });
  return (await client.mutation(api.auth.verifySignature, { walletAddress: account.address, message, signature: await account.signMessage({ message }) })).token;
}
report.parent = await deploy('Deploy QA Treasury with two approvers', [owner.address, second.address], 2, '20260906092001'); save();
report.payroll = await deploy('Deploy QA Payroll owned by Treasury', [report.parent], 1, '20260906092002'); save();
const adminToken = await login(owner), secondToken = await login(second);
try {
  const scope = { orgId: workspace.orgId, sessionToken: adminToken };
  let accounts = await client.query(api.safes.getForOrg, scope);
  for (const [name, address] of [['QA Treasury approval group', report.parent], ['QA Payroll account', report.payroll]]) {
    if (!accounts.some(a => a.safeAddress.toLowerCase() === address.toLowerCase())) await client.action(api.safes.link, { ...scope, chainId: 11155111, safeAddress: address, name });
  }
  accounts = await client.query(api.safes.getForOrg, scope);
  report.safeId = accounts.find(a => a.safeAddress.toLowerCase() === report.payroll.toLowerCase())._id; save();
  pass('Nested-only Payroll account links through verified Treasury ownership');
  const members = await client.query(api.orgs.listMembers, scope);
  const secondMember = members.find(m => m?.walletAddress.toLowerCase() === second.address.toLowerCase() && m.status === 'active');
  if (!secondMember) {
    await client.mutation(api.orgs.inviteMember, { ...scope, memberWalletAddress: second.address, memberName: 'QA second approver', role: 'approver' });
    await client.mutation(api.orgs.acceptInvite, { orgId: workspace.orgId, sessionToken: secondToken });
  } else if (!['admin', 'approver'].includes(secondMember.role)) {
    await client.mutation(api.orgs.updateMemberRole, { ...scope, membershipId: secondMember.membershipId, newRole: 'approver' });
  }
  let review = await client.query(api.recipientReviews.get, { beneficiaryId: workspace.beneficiaryIds[0], sessionToken: adminToken });
  if (review.recipient.payoutReviewStatus !== 'approved' || review.pending) {
    if (!review.pending) await client.mutation(api.recipientReviews.request, { beneficiaryId: workspace.beneficiaryIds[0], sessionToken: adminToken });
    review = await client.query(api.recipientReviews.get, { beneficiaryId: workspace.beneficiaryIds[0], sessionToken: secondToken });
    assert.equal(review.pending.proposed.walletAddress.toLowerCase(), owner.address.toLowerCase());
    assert.equal(review.pending.proposed.preferredChainId, 11155111);
    assert.equal(review.pending.proposed.preferredToken, 'USDC');
    await client.mutation(api.recipientReviews.decide, { changeId: review.pending._id, sessionToken: secondToken, decision: 'approved', reason: 'QA only: full recipient address matches the isolated test wallet controlled by this acceptance script; Sepolia USDC instructions verified.', verificationMethod: 'verified_portal', confirmedIndependently: true });
  }
  const token = CHAIN_TOKENS[11155111].USDC.address;
  if (!report.parentOpening) {
    report.parentOpening = { native: (await chain.getBalance({ address: report.parent })).toString(), usdc: (await chain.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [report.parent] })).toString() }; save();
  }
  if (!report.disbursementId) {
    report.disbursementId = (await client.mutation(api.paymentRuns.create, { ...scope, safeId: report.safeId, chainId: 11155111, token: 'USDC', name: 'QA nested account payment', purpose: 'other', recipients: [{ beneficiaryId: workspace.beneficiaryIds[0], amount: '0.000001' }] })).disbursementId;
    save();
  }
  const args = { disbursementId: report.disbursementId, sessionToken: adminToken };
  let payment = await client.query(api.disbursements.getWithRecipients, args);
  if (payment.status !== 'executed') {
    if (!report.proposal) { report.proposal = (await client.action(api.accountApprovals.forSigning, args)).proposal; save(); }
    const path = [report.payroll.toLowerCase(), report.parent.toLowerCase()];
    const signing = approvalSigningData(11155111, path, report.proposal.safeTransactionData);
    if (!payment.safeTxHash) {
      const signature = await owner.sign({ hash: signing.hash });
      await client.action(api.accountApprovals.save, { ...args, path, signature, proposal: report.proposal });
      await client.action(api.accountApprovals.save, { ...args, path, signature, proposal: report.proposal });
      await client.mutation(api.disbursements.updateStatus, { ...args, status: 'proposed', safeTxHash: report.proposal.safeTxHash });
    }
    if (!report.secondApproved) {
      const status = await client.action(api.paymentExecution.approvalStatus, args);
      assert.equal(status.ready, false); assert.deepEqual(status.confirmedOwners, []);
      assert.equal(status.workspace.groups.find(g => g.address === report.parent.toLowerCase()).confirmedOwners.length, 1);
      pass('One Treasury signature contributes zero Payroll approvals');
      await assert.rejects(client.action(api.accountApprovals.execution, args), /needs owner signatures/);
      pass('Execution rejects an incomplete parent threshold');
      const request = await client.action(api.accountApprovals.forSigning, { ...args, sessionToken: secondToken });
      assert.equal(request.proposal.safeTxHash, report.proposal.safeTxHash);
      await client.action(api.accountApprovals.save, { ...args, sessionToken: secondToken, path, proposal: request.proposal, signature: await second.sign({ hash: signing.hash }) });
      report.secondApproved = true; save();
    }
    const status = await client.action(api.paymentExecution.approvalStatus, args);
    assert.equal(status.ready, true); assert.deepEqual(status.confirmedOwners, [report.parent.toLowerCase()]);
    pass('Two Treasury signatures assemble one on-chain-validated Payroll approval');
    if (!report.funded) {
      await send('Fund QA Payroll with one test USDC unit', { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [report.payroll, 1n] }) });
      report.funded = true; save();
    }
    const transaction = await client.action(api.accountApprovals.execution, args);
    payment = await client.query(api.disbursements.getWithRecipients, args);
    if (payment.status === 'proposed') await client.action(api.nativePayments.start, { ...args, safeTxHash: report.proposal.safeTxHash });
    report.paymentHash = await send('Execute nested QA Payroll payment', transaction); save();
    await client.mutation(api.disbursements.updateStatus, { ...args, status: 'relaying', txHash: report.paymentHash });
    await client.action(api.paymentExecution.confirm, { ...args, txHash: report.paymentHash });
  }
  const final = await client.query(api.disbursements.getWithRecipients, args);
  assert.equal(final.status, 'executed'); assert.equal(final.totalAmount, '0.000001');
  const nonce = await chain.readContract({ address: report.parent, abi: parseAbi(['function nonce() view returns (uint256)']), functionName: 'nonce' });
  assert.equal(nonce, 0n);
  assert.equal((await chain.getBalance({ address: report.parent })).toString(), report.parentOpening.native);
  assert.equal((await chain.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [report.parent] })).toString(), report.parentOpening.usdc);
  pass('Nested payment settles exact principal while Treasury nonce and balance stay unchanged');
  report.complete = true; report.checkedAt = new Date().toISOString(); save();
} finally {
  await Promise.all([client.mutation(api.auth.logout, { token: adminToken }), client.mutation(api.auth.logout, { token: secondToken })]);
}
