/** Built-browser signed cancellation on the existing isolated Sepolia hierarchy.
 * Authorizes one empty account transaction. Does not pay a recipient or grant an allowance. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { createPublicClient, createWalletClient, http, decodeFunctionData, hashTypedData, keccak256, parseAbi, erc20Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { api } from '../convex/_generated/api.js';
import { allowanceAbi } from '../shared/allowance.ts';
import { CURRENT_ALLOWANCE } from '../shared/allowanceDeployments.ts';
import { CHAIN_TOKENS } from '../shared/chains.ts';
import { approvalSigningData } from '../shared/safeSignatures.ts';
import { openQaWallet } from './lib/qaBrowserWallet.mjs';
assert.equal(process.env.CONVEX_DEPLOYMENT, 'dev:fortunate-cat-122');
assert.equal(process.env.VITE_CONVEX_URL, 'https://fortunate-cat-122.convex.cloud');
const dir = '.local/qa', nested = JSON.parse(readFileSync(`${dir}/account-approvals-evidence.json`));
const owner = privateKeyToAccount(JSON.parse(readFileSync(`${dir}/wallet.json`)).privateKey);
const second = privateKeyToAccount(JSON.parse(readFileSync(`${dir}/recipients.json`))[1]);
assert.equal(nested.orgId, 'k575vpg8mtsn2126zbswdg4rfd8dvk88');
assert.equal(owner.address, '0x01585228489577cdCdbd5eBb822C7c439a2c564c');
assert.equal(nested.complete, true);
const file = `${dir}/browser-cancellation-evidence.json`;
const report = existsSync(file) ? JSON.parse(readFileSync(file)) : { orgId: nested.orgId, payroll: nested.payroll, parent: nested.parent, chainId: 11155111, checks: [], startedAt: Date.now() };
assert.equal(report.orgId, nested.orgId); assert.equal(report.payroll, nested.payroll); assert.equal(report.parent, nested.parent); assert.equal(report.chainId, 11155111);
if (report.complete) { console.log('Built cancellation already verified; no account change repeated'); process.exit(0); }
const save = () => writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
const pass = name => { if (!report.checks.includes(name)) report.checks.push(name); save(); console.log(`PASS ${name}`); };
const baseURL = 'http://127.0.0.1:4180'; assert.equal((await fetch(baseURL)).status, 200);
const rpc = process.env.QA_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const chain = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 20000, retryCount: 1 }) });
assert.equal(await chain.getChainId(), 11155111);
const sender = createWalletClient({ chain: sepolia, transport: http(rpc), account: owner });
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: false });
const safeAbi = parseAbi(['function nonce() view returns (uint256)', 'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)']);
const sessions = [];
async function login(account) { const { message } = await client.mutation(api.auth.generateNonce, { walletAddress: account.address }); const { token } = await client.mutation(api.auth.verifySignature, { walletAddress: account.address, message, signature: await account.signMessage({ message }) }); sessions.push(token); return token; }
const adminToken = await login(owner), secondToken = await login(second);
const scope = { safeId: nested.safeId, sessionToken: adminToken };
const browser = await chromium.launch();
let lastPage;
const rows = async () => (await client.query(api.spendingPolicyData.list, scope)).proposals;
const current = async () => client.query(api.accountCancellationData.get, { policyChangeId: report.policyId, sessionToken: adminToken });
const view = async sessionToken => client.action(api.accountCancellations.approvals, { cancellationId: report.cancellationId, sessionToken });
async function balances() { return { payroll: String(await chain.readContract({ address: CHAIN_TOKENS[11155111].USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [nested.payroll] })), parent: String(await chain.readContract({ address: CHAIN_TOKENS[11155111].USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [nested.parent] })), parentNative: String(await chain.getBalance({ address: nested.parent })), parentNonce: String(await chain.readContract({ address: nested.parent, abi: safeAbi, functionName: 'nonce' })), allowance: String((await chain.readContract({ address: CURRENT_ALLOWANCE.address, abi: allowanceAbi, functionName: 'getTokenAllowance', args: [nested.payroll, owner.address, CHAIN_TOKENS[11155111].USDC.address] }))[0]) }; }
async function openAccount(page) { lastPage = page; await page.goto(`${baseURL}/org/${nested.orgId}/team`); await page.getByRole('tab', { name: 'Delegated spending' }).click(); await page.getByRole('combobox', { name: 'Funding account', exact: true }).selectOption(nested.safeId); await expect(page.getByRole('region', { name: 'Policy approvals' })).toBeVisible(); }
async function openWallet(account, token, theme) {
  const page = await openQaWallet({ browser, account, chain, orgId: nested.orgId, theme, baseURL, onSession: token => sessions.push(token),
    signTypedData: async typed => {
      assert.ok(report.policyId);
      const request = report.cancellationId ? await view(token) : await client.action(api.spendingPolicies.approvals, { policyChangeId: report.policyId, sessionToken: token });
      assert.equal(hashTypedData(typed), approvalSigningData(11155111, [nested.payroll, nested.parent], request.proposal.safeTransactionData).hash);
      if (report.cancellationId && account.address === owner.address && !report.signatureDeclined) { report.signatureDeclined = true; save(); return { error: { code: 4001, message: 'User declined cancellation approval' } }; }
      return { value: await account.signTypedData(typed) };
    },
    sendTransaction: async tx => {
      assert.ok(report.cancellationId); assert.equal(account.address, owner.address); assert.equal(tx.from.toLowerCase(), owner.address.toLowerCase()); assert.equal(tx.to.toLowerCase(), nested.payroll.toLowerCase()); assert.equal(BigInt(tx.value || '0'), 0n);
      const request = await view(token), record = (await current()).cancellation;
      assert.equal(record.executionFee, undefined);
      const decoded = decodeFunctionData({ abi: safeAbi, data: tx.data }); assert.equal(decoded.functionName, 'execTransaction');
      const [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver] = decoded.args;
      assert.equal(to.toLowerCase(), nested.payroll.toLowerCase()); assert.equal(value, 0n); assert.equal(data, '0x'); assert.equal(operation, 0); assert.equal(safeTxGas, 0n); assert.equal(baseGas, 0n); assert.equal(gasPrice, 0n); assert.equal(BigInt(gasToken), 0n); assert.equal(BigInt(refundReceiver), 0n);
      const intent = { to, value: String(value), data, operation, safeTxGas: String(safeTxGas), baseGas: String(baseGas), gasPrice: String(gasPrice), gasToken, refundReceiver, nonce: request.proposal.safeTransactionData.nonce };
      assert.equal(approvalSigningData(11155111, [nested.payroll], intent).hash, request.proposal.safeTxHash);
      if (!report.sendDeclined) { report.sendDeclined = true; save(); return { error: { code: 4001, message: 'User declined cancellation send' } }; }
      if (!report.broadcast) { const prepared = await sender.prepareTransactionRequest({ to: nested.payroll, data: tx.data, value: 0n, account: owner }); const raw = await owner.signTransaction(prepared); report.broadcast = { raw, hash: keccak256(raw), safeTxHash: request.proposal.safeTxHash }; save(); }
      const receipt = await chain.getTransactionReceipt({ hash: report.broadcast.hash }).catch(() => null);
      if (!receipt) await chain.sendRawTransaction({ serializedTransaction: report.broadcast.raw }).catch(error => { if (!/already known|nonce too low|known transaction/i.test(String(error))) throw error; });
      return { value: report.broadcast.hash };
    },
  });
  await openAccount(page); return page;
}
async function requestOriginal(page) {
  if (report.policyId) return;
  let matching = (await rows()).filter(p => p.intent.kind === 'grant' && p.intent.amount === '0.000003' && p.createdAt >= report.startedAt && p.intent.delegate.toLowerCase() === owner.address.toLowerCase());
  assert.ok(matching.length <= 1);
  if (!matching.length) {
    await page.getByRole('button', { name: 'Set allowance', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Set delegated allowance' });
    await dialog.getByRole('combobox', { name: 'Team member' }).selectOption(owner.address.toLowerCase()); await dialog.getByRole('textbox', { name: 'Allowance', exact: true }).fill('0.000003');
    await dialog.getByRole('combobox', { name: 'Execution fee' }).selectOption('wallet'); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Request account approval' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 90000 });
    matching = (await rows()).filter(p => p.intent.kind === 'grant' && p.intent.amount === '0.000003' && p.createdAt >= report.startedAt && p.intent.delegate.toLowerCase() === owner.address.toLowerCase());
  }
  assert.equal(matching.length, 1); report.policyId = matching[0]._id; save();
}
async function approveCancellation(page, token, first) {
  if (!(await view(token)).paths.some(p => !p.approved)) return;
  const section = page.getByRole('region', { name: 'Account cancellation' });
  const sign = async () => { await section.getByRole('checkbox').check(); await section.getByRole('button', { name: 'Approve cancellation' }).click(); const path = section.getByRole('region', { name: 'Choose approval account' }); await expect(path).toContainText('QA Treasury'); await path.getByRole('button', { name: 'Confirm approval in wallet' }).click(); };
  const decline = first && !report.signatureDeclined;
  await sign();
  if (decline) { await expect(section.getByRole('alert')).toContainText('No approval was added'); await openAccount(page); await sign(); pass('Declined cancellation signature adds no approval and survives reload'); }
  await expect.poll(async () => (await view(token)).paths.every(p => p.approved), { timeout: 90000, intervals: [2000] }).toBe(true);
  if (first) await expect(section.getByRole('button', { name: 'Complete cancellation' })).toBeDisabled();
}
try {
  if (!report.before) { report.before = await balances(); report.nonceBefore = String(await chain.readContract({ address: nested.payroll, abi: safeAbi, functionName: 'nonce' })); save(); }
  const first = await openWallet(owner, adminToken, 'light');
  await requestOriginal(first);
  if (!report.cancellationId) {
    const existing = (await current()).cancellation;
    if (existing) { report.cancellationId = existing._id; save(); }
    else {
      const queue = first.getByRole('region', { name: 'Policy approvals' });
      const original = await client.action(api.spendingPolicies.approvals, { policyChangeId: report.policyId, sessionToken: adminToken });
      if (original.paths.some(p => !p.approved)) { await queue.getByRole('checkbox').check(); await queue.getByRole('button', { name: 'Approve policy' }).click(); await queue.getByRole('button', { name: 'Confirm approval in wallet' }).click(); await expect.poll(async () => (await client.action(api.spendingPolicies.approvals, { policyChangeId: report.policyId, sessionToken: adminToken })).paths.every(p => p.approved), { timeout: 90000, intervals: [2000] }).toBe(true); }
      await queue.getByRole('button', { name: 'Cancel policy request', exact: true }).click();
      const section = queue.getByRole('region', { name: 'Account cancellation' });
      await section.getByRole('combobox', { name: 'Cancellation fee' }).selectOption('wallet'); await section.getByRole('checkbox').check(); await section.getByRole('button', { name: 'Request cancellation approval' }).click();
      await expect.poll(async () => !!(await current()).cancellation, { timeout: 90000, intervals: [2000] }).toBe(true);
      report.cancellationId = (await current()).cancellation._id; save();
    }
  }
  pass('The built app requests cancellation for an already signed policy');
  if ((await current()).cancellation.status !== 'applied') {
    await openAccount(first); await approveCancellation(first, adminToken, true);
    const other = await openWallet(second, secondToken, 'dark'); await approveCancellation(other, secondToken, false);
    await other.getByRole('region', { name: 'Account cancellation' }).scrollIntoViewIfNeeded(); await other.screenshot({ path: `${dir}/built-cancellation-dark.png`, fullPage: true });
    await openAccount(first);
    const section = first.getByRole('region', { name: 'Account cancellation' });
    const c = (await current()).cancellation;
    if (c.status === 'pending') { await section.getByRole('checkbox').check(); await section.getByRole('button', { name: 'Complete cancellation' }).click(); await expect(section.getByRole('button', { name: 'Retry original cancellation' })).toBeVisible(); await openAccount(first); }
    if ((await current()).cancellation.execution?.walletRejectedAt) { await section.getByRole('checkbox').check(); await section.getByRole('button', { name: 'Retry original cancellation' }).click(); pass('Declined cancellation send retries the exact original intent after reload'); }
    await expect.poll(async () => (await current()).cancellation.status, { timeout: 180000, intervals: [3000] }).toBe('applied');
  }
  report.after = await balances(); assert.deepEqual(report.after, report.before);
  assert.equal(String(await chain.readContract({ address: nested.payroll, abi: safeAbi, functionName: 'nonce' })), String(BigInt(report.nonceBefore) + 1n));
  const original = (await rows()).find(p => p._id === report.policyId); assert.equal(original.status, 'cancelled'); assert.ok(original.cancellationConfirmedAt);
  const confirmed = (await current()).cancellation; assert.equal(confirmed.txHash, report.broadcast.hash);
  await openAccount(first); await first.getByRole('button', { name: 'View recent policy changes' }).click(); await expect(first.getByRole('region', { name: 'Account cancellation' })).toContainText('The original transaction can no longer execute');
  await first.screenshot({ path: `${dir}/built-cancellation-complete.png`, fullPage: true });
  pass('Confirmed cancellation consumes the original nonce without changing stablecoin balances, parent state or delegated allowance');
  report.complete = true; report.checkedAt = new Date().toISOString(); save(); console.log(`Cancellation receipt: ${report.broadcast.hash}`);
} catch (error) { if (lastPage) await lastPage.screenshot({ path: `${dir}/built-cancellation-failure.png`, fullPage: true }); throw error; }
finally { await browser.close(); await Promise.allSettled(sessions.map(token => client.mutation(api.auth.logout, { token }))); }
