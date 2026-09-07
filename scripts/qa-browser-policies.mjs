/** Real built-app policy request, nested approvals, native recovery and revocation.
 * Restricted to the pre-existing isolated Sepolia QA hierarchy. */
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
const file = `${dir}/browser-policies-evidence.json`;
const report = existsSync(file) ? JSON.parse(readFileSync(file)) : { orgId: nested.orgId, payroll: nested.payroll, parent: nested.parent, chainId: 11155111, transactions: [], checks: [], startedAt: Date.now() };
assert.equal(report.orgId, nested.orgId); assert.equal(report.payroll, nested.payroll); assert.equal(report.parent, nested.parent); assert.equal(report.chainId, 11155111);
if (report.complete) { console.log('Built policy acceptance already complete; no account change repeated'); process.exit(0); }
const save = () => writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
const pass = name => { if (!report.checks.includes(name)) report.checks.push(name); save(); console.log(`PASS ${name}`); };
const baseURL = 'http://127.0.0.1:4180'; assert.equal((await fetch(baseURL)).status, 200);
const rpc = process.env.QA_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const chain = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 20000, retryCount: 1 }) });
assert.equal(await chain.getChainId(), 11155111);
const sender = createWalletClient({ chain: sepolia, transport: http(rpc), account: owner });
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: false });
const safeAbi = parseAbi(['function nonce() view returns (uint256)', 'function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)', 'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)']);
const sessions = [];
async function login(account) { const { message } = await client.mutation(api.auth.generateNonce, { walletAddress: account.address }); const { token } = await client.mutation(api.auth.verifySignature, { walletAddress: account.address, message, signature: await account.signMessage({ message }) }); sessions.push(token); return token; }
const adminToken = await login(owner), secondToken = await login(second);
const scope = { safeId: nested.safeId, sessionToken: adminToken };
const browser = await chromium.launch();
let lastPage, currentKind = 'grant';
const policyId = () => report[`${currentKind}Id`];
async function list() { return (await client.query(api.spendingPolicyData.list, scope)).proposals; }
async function balances() { return { payroll: String(await chain.readContract({ address: CHAIN_TOKENS[11155111].USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [nested.payroll] })), parent: String(await chain.readContract({ address: CHAIN_TOKENS[11155111].USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [nested.parent] })), parentNative: String(await chain.getBalance({ address: nested.parent })), parentNonce: String(await chain.readContract({ address: nested.parent, abi: safeAbi, functionName: 'nonce' })) }; }
async function openAccount(page) { lastPage = page; await page.goto(`${baseURL}/org/${nested.orgId}/team`); await page.getByRole('tab', { name: 'Delegated spending' }).click(); await page.getByRole('combobox', { name: 'Funding account', exact: true }).selectOption(nested.safeId); await expect(page.getByRole('region', { name: 'Policy approvals' })).toBeVisible(); }
async function openWallet(account, sessionToken, theme) {
  const page = await openQaWallet({ browser, account, chain, orgId: nested.orgId, theme, baseURL, onSession: token => sessions.push(token),
    signTypedData: async typed => {
      assert.ok(policyId());
      const view = await client.action(api.spendingPolicies.approvals, { policyChangeId: policyId(), sessionToken });
      assert.equal(hashTypedData(typed), approvalSigningData(11155111, [nested.payroll, nested.parent], view.proposal.safeTransactionData).hash);
      if (currentKind === 'grant' && account.address === owner.address && !report.signatureDeclined) { report.signatureDeclined = true; save(); return { error: { code: 4001, message: 'User declined the policy approval' } }; }
      return { value: await account.signTypedData(typed) };
    },
    sendTransaction: async tx => {
      assert.equal(account.address, owner.address); assert.equal(tx.from.toLowerCase(), owner.address.toLowerCase()); assert.equal(tx.to.toLowerCase(), nested.payroll.toLowerCase()); assert.equal(BigInt(tx.value || '0'), 0n);
      const view = await client.action(api.spendingPolicies.approvals, { policyChangeId: policyId(), sessionToken });
      const decoded = decodeFunctionData({ abi: safeAbi, data: tx.data }); assert.equal(decoded.functionName, 'execTransaction');
      const [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver] = decoded.args;
      const intent = { to, value: String(value), data, operation, safeTxGas: String(safeTxGas), baseGas: String(baseGas), gasPrice: String(gasPrice), gasToken, refundReceiver, nonce: view.proposal.safeTransactionData.nonce };
      assert.equal(approvalSigningData(11155111, [nested.payroll], intent).hash, view.proposal.safeTxHash);
      const record = (await list()).find(p => p._id === policyId()); assert.equal(record.executionFee, undefined); assert.equal(record.intent.delegate.toLowerCase(), owner.address.toLowerCase()); assert.equal(record.intent.module.toLowerCase(), CURRENT_ALLOWANCE.address.toLowerCase()); assert.equal(record.intent.kind, currentKind); assert.equal(record.intent.tokenAddress.toLowerCase(), CHAIN_TOKENS[11155111].USDC.address.toLowerCase());
      if (currentKind === 'grant') { assert.equal(record.intent.amount, '0.000002'); if (!report.sendDeclined) { report.sendDeclined = true; save(); return { error: { code: 4001, message: 'User declined the policy send' } }; } }
      const label = `${currentKind} nested spending policy`;
      let broadcast = report.transactions.find(t => t.label === label);
      if (!broadcast) { const request = await sender.prepareTransactionRequest({ to: nested.payroll, data: tx.data, value: 0n, account: owner }); const raw = await owner.signTransaction(request); broadcast = { label, raw, hash: keccak256(raw), safeTxHash: view.proposal.safeTxHash }; report.transactions.push(broadcast); save(); }
      const receipt = await chain.getTransactionReceipt({ hash: broadcast.hash }).catch(() => null);
      if (!receipt) await chain.sendRawTransaction({ serializedTransaction: broadcast.raw }).catch(error => { if (!/already known|nonce too low|known transaction/i.test(String(error))) throw error; });
      return { value: broadcast.hash };
    },
  });
  await openAccount(page); return page;
}
async function findOrRequest(page, kind) {
  currentKind = kind;
  if (report[`${kind}Id`]) return;
  const matching = (await list()).filter(p => p.intent.kind === kind && p.intent.delegate.toLowerCase() === owner.address.toLowerCase() && p.createdAt >= report.startedAt && (kind === 'revoke' || p.intent.amount === '0.000002'));
  assert.ok(matching.length < 2, 'Ambiguous QA policy request');
  if (!matching.length) {
    if (kind === 'grant') await page.getByRole('button', { name: 'Set allowance', exact: true }).click();
    else await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: kind === 'grant' ? 'Set delegated allowance' : 'Revoke allowance' });
    if (kind === 'grant') { await dialog.getByRole('combobox', { name: 'Team member' }).selectOption(owner.address.toLowerCase()); await dialog.getByRole('textbox', { name: 'Allowance', exact: true }).fill('0.000002'); }
    await dialog.getByRole('combobox', { name: 'Execution fee' }).selectOption('wallet');
    await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Request account approval' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 90000 });
  }
  const requested = (await list()).filter(p => p.intent.kind === kind && p.intent.delegate.toLowerCase() === owner.address.toLowerCase() && p.createdAt >= report.startedAt && (kind === 'revoke' || p.intent.amount === '0.000002'));
  assert.equal(requested.length, 1); report[`${kind}Id`] = requested[0]._id; save();
  pass(`${kind}: the built form persists an exact policy request without an implicit owner signature`);
}
async function approveInBrowser(page, sessionToken, isFirst) {
  let view = await client.action(api.spendingPolicies.approvals, { policyChangeId: policyId(), sessionToken });
  if (!view.paths.some(p => !p.approved)) return;
  const queue = page.getByRole('region', { name: 'Policy approvals' });
  await queue.getByRole('checkbox').check(); await queue.getByRole('button', { name: 'Approve policy' }).click();
  const path = queue.getByRole('region', { name: 'Choose approval account' }); await expect(path).toContainText('QA Treasury');
  const decline = currentKind === 'grant' && isFirst && !report.signatureDeclined;
  await path.getByRole('button', { name: 'Confirm approval in wallet' }).click();
  if (decline) {
    await expect(queue.getByRole('alert')).toContainText('No approval was added'); await openAccount(page);
    await queue.getByRole('checkbox').check(); await queue.getByRole('button', { name: 'Approve policy' }).click(); await path.getByRole('button', { name: 'Confirm approval in wallet' }).click();
  }
  await expect.poll(async () => (await client.action(api.spendingPolicies.approvals, { policyChangeId: policyId(), sessionToken })).paths.every(p => p.approved), { timeout: 90000, intervals: [2000] }).toBe(true);
  if (isFirst) { await expect(queue.getByRole('button', { name: 'Apply policy' })).toBeDisabled(); pass(`${currentKind}: one parent approval cannot apply the policy`); }
}
try {
  if (!report.before) { report.before = await balances(); save(); }
  const first = await openWallet(owner, adminToken, 'light');
  await findOrRequest(first, 'grant');
  const other = await openWallet(second, secondToken, 'dark');
  for (const kind of ['grant', 'revoke']) {
    await openAccount(first); await findOrRequest(first, kind);
    if ((await list()).find(p => p._id === policyId()).status === 'applied') continue;
    await approveInBrowser(first, adminToken, true);
    await openAccount(other); await approveInBrowser(other, secondToken, false);
    await other.getByRole('region', { name: 'Policy approvals' }).scrollIntoViewIfNeeded();
    await other.screenshot({ path: `${dir}/built-${kind}-policy-dark.png`, fullPage: true });
    await openAccount(first); lastPage = first;
    const queue = first.getByRole('region', { name: 'Policy approvals' });
    const current = (await list()).find(p => p._id === policyId());
    if (current.status === 'pending') {
      await queue.getByRole('checkbox').check(); await expect(queue.getByRole('button', { name: 'Apply policy' })).toBeEnabled();
      await queue.getByRole('button', { name: 'Apply policy' }).click();
      if (kind === 'grant') {
        await expect(queue.getByRole('button', { name: 'Retry original policy' })).toBeVisible(); await openAccount(first);
        await queue.getByRole('checkbox').check(); await queue.getByRole('button', { name: 'Retry original policy' }).click();
        pass('A declined policy send survives reload and retries the exact original account intent');
      }
    } else if (current.status === 'processing' && current.execution?.walletRejectedAt) {
      await queue.getByRole('checkbox').check(); await queue.getByRole('button', { name: 'Retry original policy' }).click();
    }
    await expect.poll(async () => (await list()).find(p => p._id === policyId())?.status, { timeout: 180000, intervals: [3000] }).toBe('applied');
    const allowance = await chain.readContract({ address: CURRENT_ALLOWANCE.address, abi: allowanceAbi, functionName: 'getTokenAllowance', args: [nested.payroll, owner.address, CHAIN_TOKENS[11155111].USDC.address] });
    assert.equal(allowance[0], kind === 'grant' ? 2n : 0n);
    const tx = report.transactions.find(t => t.label === `${kind} nested spending policy`); assert.ok(tx);
    pass(`${kind}: confirmed Sepolia receipt and contract allowance match the built-app request`);
    console.log(`${kind} receipt: ${tx.hash}`);
  }
  report.after = await balances(); assert.deepEqual(report.after, report.before);
  assert.equal(report.transactions.length, 2);
  await openAccount(first);
  await expect(first.getByText('No allowances recorded in this module.')).toBeVisible();
  await first.getByRole('button', { name: 'View recent policy changes' }).click();
  await expect(first.getByRole('region', { name: 'Policy approvals' }).getByText('Applied', { exact: true })).toHaveCount(2);
  await first.screenshot({ path: `${dir}/built-policy-complete-light.png`, fullPage: true });
  pass('Grant revoked; payroll and parent stablecoin balances plus parent native balance and transaction nonce remain unchanged');
  report.complete = true; report.checkedAt = new Date().toISOString(); save();
} catch (error) {
  if (lastPage) { await lastPage.screenshot({ path: `${dir}/built-policy-failure.png`, fullPage: true }); console.log(`Browser stopped at ${new URL(lastPage.url()).pathname}`); }
  throw error;
} finally {
  await browser.close(); await Promise.allSettled(sessions.map(token => client.mutation(api.auth.logout, { token })));
}
