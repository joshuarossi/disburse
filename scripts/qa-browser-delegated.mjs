/** Built app acceptance of a native-fee allowance payment, including response loss.
 * Seeds and revokes a two-base-unit grant only in the isolated Sepolia QA account. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { createPublicClient, createWalletClient, http, encodeFunctionData, keccak256, parseAbi, erc20Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { api } from '../convex/_generated/api.js';
import { allowanceAbi } from '../shared/allowance.ts';
import { CURRENT_ALLOWANCE } from '../shared/allowanceDeployments.ts';
import { CHAIN_TOKENS } from '../shared/chains.ts';
import { approvalSigningData } from '../shared/safeSignatures.ts';
import { delegatedAccountCall } from '../shared/delegatedAccountCall.ts';
import { openQaWallet } from './lib/qaBrowserWallet.mjs';
assert.equal(process.env.CONVEX_DEPLOYMENT, 'dev:fortunate-cat-122');
assert.equal(process.env.VITE_CONVEX_URL, 'https://fortunate-cat-122.convex.cloud');
const dir = '.local/qa', nested = JSON.parse(readFileSync(`${dir}/account-approvals-evidence.json`));
const owner = privateKeyToAccount(JSON.parse(readFileSync(`${dir}/wallet.json`)).privateKey), second = privateKeyToAccount(JSON.parse(readFileSync(`${dir}/recipients.json`))[1]);
assert.equal(nested.orgId, 'k575vpg8mtsn2126zbswdg4rfd8dvk88'); assert.equal(owner.address, '0x01585228489577cdCdbd5eBb822C7c439a2c564c'); assert.equal(nested.complete, true);
const file = `${dir}/browser-delegated-evidence.json`;
const report = existsSync(file) ? JSON.parse(readFileSync(file)) : { orgId: nested.orgId, payroll: nested.payroll, parent: nested.parent, chainId: 11155111, checks: [], transactions: [], startedAt: Date.now() };
assert.equal(report.orgId, nested.orgId); assert.equal(report.payroll, nested.payroll); assert.equal(report.parent, nested.parent); assert.equal(report.chainId, 11155111);
if (report.complete) { console.log('Built delegated acceptance already complete; no payment repeated'); process.exit(0); }
const save = () => writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
const pass = name => { if (!report.checks.includes(name)) report.checks.push(name); save(); console.log(`PASS ${name}`); };
const baseURL = 'http://127.0.0.1:4180'; assert.equal((await fetch(baseURL)).status, 200);
const rpc = process.env.QA_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const chain = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 20000, retryCount: 1 }) }), sender = createWalletClient({ chain: sepolia, transport: http(rpc), account: owner });
assert.equal(await chain.getChainId(), 11155111);
const token = CHAIN_TOKENS[11155111].USDC.address;
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: false });
const safeAbi = parseAbi(['function nonce() view returns (uint256)']);
const sessions = [];
async function login(account) { const { message } = await client.mutation(api.auth.generateNonce, { walletAddress: account.address }); const { token } = await client.mutation(api.auth.verifySignature, { walletAddress: account.address, message, signature: await account.signMessage({ message }) }); sessions.push(token); return token; }
const adminToken = await login(owner), secondToken = await login(second);
const scope = { safeId: nested.safeId, sessionToken: adminToken };
const browser = await chromium.launch(); let lastPage;
async function send(label, to, data) {
  assert.ok([nested.payroll, CURRENT_ALLOWANCE.address, token].some(a => a.toLowerCase() === to.toLowerCase()));
  let saved = report.transactions.find(t => t.label === label);
  if (!saved) { const request = await sender.prepareTransactionRequest({ to, data, value: 0n, account: owner }); const raw = await owner.signTransaction(request); saved = { label, to, data, raw, hash: keccak256(raw) }; report.transactions.push(saved); save(); }
  assert.equal(saved.to.toLowerCase(), to.toLowerCase()); assert.equal(saved.data, data);
  const receipt = await chain.getTransactionReceipt({ hash: saved.hash }).catch(() => null);
  if (!receipt) await chain.sendRawTransaction({ serializedTransaction: saved.raw }).catch(error => { if (!/already known|nonce too low|known transaction/i.test(String(error))) throw error; });
  return saved.hash;
}
const rows = async () => (await client.query(api.spendingPolicyData.list, scope)).proposals;
async function seedPolicy(kind) {
  if (!report[`${kind}Request`]) { report[`${kind}Request`] = crypto.randomUUID(); save(); }
  if (!report[`${kind}Id`]) { report[`${kind}Id`] = await client.action(api.spendingPolicies.create, { ...scope, requestId: report[`${kind}Request`], kind, module: CURRENT_ALLOWANCE.address, delegate: owner.address, ...(kind === 'grant' ? { token: 'USDC', amount: '0.000002', resetMinutes: 0 } : { tokenAddress: token }) }); save(); }
  const id = report[`${kind}Id`], as = { policyChangeId: id, sessionToken: adminToken };
  if ((await rows()).find(p => p._id === id)?.status === 'applied') return;
  for (const [account, sessionToken] of [[owner, adminToken], [second, secondToken]]) {
    const view = await client.action(api.spendingPolicies.approvals, { ...as, sessionToken });
    const path = view.paths.find(p => !p.approved)?.path;
    if (path) { assert.deepEqual(path, [nested.payroll.toLowerCase(), nested.parent.toLowerCase()]); const signature = await account.sign({ hash: approvalSigningData(11155111, path, view.proposal.safeTransactionData).hash }); await client.action(api.spendingPolicies.approve, { ...as, sessionToken, path, signature, safeTxHash: view.proposal.safeTxHash }); }
  }
  if (!report[`${kind}Execution`]) { report[`${kind}Execution`] = await client.action(api.spendingPolicies.execute, as); save(); }
  const execution = report[`${kind}Execution`]; assert.equal(execution.managed, false); assert.equal(execution.to.toLowerCase(), nested.payroll.toLowerCase());
  const txHash = await send(`${kind} fixture allowance`, execution.to, execution.data);
  const current = (await rows()).find(p => p._id === id);
  if (current.status === 'processing' && !current.execution?.txHash) await client.mutation(api.spendingPolicyData.recordBroadcast, { ...as, attemptId: execution.attemptId, txHash });
  await expect.poll(async () => (await rows()).find(p => p._id === id)?.status, { timeout: 240000, intervals: [3000] }).toBe('applied');
  pass(`${kind} fixture allowance confirmed`);
}
async function balances() { const result = {}; for (const [label, address] of [['payroll', nested.payroll], ['parent', nested.parent], ['owner', owner.address]]) result[label] = String(await chain.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address] })); result.parentNative = String(await chain.getBalance({ address: nested.parent })); result.parentNonce = String(await chain.readContract({ address: nested.parent, abi: safeAbi, functionName: 'nonce' })); return result; }
const payment = async () => client.query(api.disbursements.get, { disbursementId: report.paymentId, sessionToken: adminToken });
async function openPayment(page) { lastPage = page; await page.goto(`${baseURL}/org/${nested.orgId}/disbursements?focus=${report.paymentId}`); await expect(page.getByRole('dialog', { name: 'Payment details' })).toBeVisible(); }
async function openWallet() {
  const page = await openQaWallet({ browser, account: owner, chain, orgId: nested.orgId, theme: 'light', baseURL, onSession: token => sessions.push(token),
    signTypedData: async () => { throw new Error('This allowance story must not request owner approvals'); },
    signRawMessage: async hash => {
      const quote = await client.action(api.delegatedPayments.quote, { disbursementId: report.paymentId, sessionToken: adminToken, feeMode: 'wallet' });
      assert.equal(quote.hash.toLowerCase(), hash.toLowerCase()); assert.equal(quote.fee, undefined); assert.equal(quote.amount, '0.000001'); assert.equal(quote.recipientAddress.toLowerCase(), owner.address.toLowerCase()); assert.equal(quote.safeAddress.toLowerCase(), nested.payroll.toLowerCase());
      if (!report.signatureDeclined) { report.signatureDeclined = true; save(); return { error: { code: 4001, message: 'User declined allowance authorization' } }; }
      return { value: await owner.signMessage({ message: { raw: hash } }) };
    },
    sendTransaction: async tx => {
      const p = await payment(), intent = p.allowanceExecution;
      assert.ok(intent); assert.equal(intent.feeAuthorization, undefined); assert.equal(intent.delegate.toLowerCase(), owner.address.toLowerCase()); assert.equal(intent.recipientAddress.toLowerCase(), owner.address.toLowerCase()); assert.equal(intent.amount, '0.000001'); assert.equal(intent.additionalTransfers?.length ?? 0, 0);
      const call = delegatedAccountCall(intent, 'USDC'); assert.equal(tx.to.toLowerCase(), call.to.toLowerCase()); assert.equal(tx.data, call.data); assert.equal(BigInt(tx.value || '0'), 0n); assert.equal(tx.from.toLowerCase(), owner.address.toLowerCase());
      if (!report.sendDeclined) { report.sendDeclined = true; save(); return { error: { code: 4001, message: 'User declined allowance send' } }; }
      const hash = await send('delegated payment', call.to, call.data); report.paymentHash = hash; save();
      return { error: { code: -32603, message: 'Simulated lost wallet broadcast response' } };
    },
  }); await openPayment(page); return page;
}
try {
  if (!report.before) { report.before = await balances(); save(); }
  await seedPolicy('grant');
  if (!report.funded) { const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [nested.payroll, 1n] }); const hash = await send('fund one payment unit', token, data); const receipt = await chain.waitForTransactionReceipt({ hash, confirmations: 2 }); assert.equal(receipt.status, 'success'); report.funded = true; save(); }
  if (!report.paymentId) {
    const candidates = await client.query(api.beneficiaries.list, { orgId: nested.orgId, sessionToken: adminToken });
    const recipient = candidates.find(r => r.walletAddress.toLowerCase() === owner.address.toLowerCase() && r.isActive); assert.ok(recipient);
    report.paymentId = (await client.mutation(api.paymentRuns.create, { orgId: nested.orgId, safeId: nested.safeId, sessionToken: adminToken, name: `Built allowance QA ${report.startedAt}`, purpose: 'other', token: 'USDC', chainId: 11155111, recipients: [{ beneficiaryId: recipient._id, amount: '0.000001' }] })).disbursementId; save();
  }
  report.paymentNonceBefore ??= String(await chain.readContract({ address: nested.payroll, abi: safeAbi, functionName: 'nonce' })); save();
  const first = await openWallet();
  if ((await payment()).status === 'draft') {
    const review = async () => { const dialog = first.getByRole('dialog'); await dialog.getByText('Pay with a spending allowance', { exact: true }).click(); await dialog.getByRole('combobox', { name: 'Execution fee' }).selectOption('wallet'); await dialog.getByRole('button', { name: 'Check my allowance' }).click(); await expect(dialog).toContainText('1 signature to authorize'); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Pay using allowance' }).click(); };
    const decline = !report.signatureDeclined; await review();
    if (decline) { await expect(first.getByRole('dialog').getByRole('alert')).toContainText('No allowance authorization was saved'); assert.equal((await payment()).allowanceExecution, undefined); await openPayment(first); await review(); pass('Declined allowance signature saves no authorization and can be reviewed again after reload'); }
    await expect(first.getByRole('button', { name: 'Retry original allowance payment' })).toBeVisible();
  }
  const current = await payment();
  if (current.nativeExecution?.walletRejectedAt && !current.txHash) {
    const original = current.allowanceExecution.hash;
    await openPayment(first); await first.getByRole('dialog').getByRole('checkbox').check(); await first.getByRole('button', { name: 'Retry original allowance payment' }).click();
    await expect(first.getByRole('dialog').getByRole('alert')).toContainText('wallet response was interrupted');
    assert.equal((await payment()).allowanceExecution.hash, original);
    await first.screenshot({ path: `${dir}/built-delegated-recovery.png`, fullPage: true }); await first.close();
    pass('Native send decline survives reload; an unknown broadcast retains its original authorization with the browser closed');
  }
  await expect.poll(async () => (await payment()).status, { timeout: 240000, intervals: [3000] }).toBe('executed');
  assert.equal((await payment()).txHash, report.paymentHash); assert.ok((await payment()).settlement);
  assert.equal(String(await chain.readContract({ address: nested.payroll, abi: safeAbi, functionName: 'nonce' })), report.paymentNonceBefore);
  pass('Background recovery finds the exact module receipt without a returned wallet hash and marks the payment paid');
  await seedPolicy('revoke');
  report.after = await balances(); assert.deepEqual(report.after, report.before);
  assert.equal((await chain.readContract({ address: CURRENT_ALLOWANCE.address, abi: allowanceAbi, functionName: 'getTokenAllowance', args: [nested.payroll, owner.address, token] }))[0], 0n);
  const final = await openWallet(); await expect(final.getByRole('dialog')).toContainText('Paid'); await final.screenshot({ path: `${dir}/built-delegated-paid.png`, fullPage: true });
  report.complete = true; report.checkedAt = new Date().toISOString(); save(); pass('Fixture grant revoked; account and recipient principal balances reconcile'); console.log(`Delegated payment receipt: ${report.paymentHash}`);
} catch (error) { if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: `${dir}/built-delegated-failure.png`, fullPage: true }); throw error; }
finally { await browser.close(); await Promise.allSettled(sessions.map(token => client.mutation(api.auth.logout, { token }))); }
