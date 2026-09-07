/** Built-app Sepolia acceptance. Isolated EIP-1193 wallets; signing keys stay in this process. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { openQaWallet } from './lib/qaBrowserWallet.mjs';
import { chromium, expect } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { createPublicClient, createWalletClient, http, erc20Abi, encodeFunctionData, hashTypedData, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { api } from '../convex/_generated/api.js';
import { CHAIN_TOKENS } from '../shared/chains.ts';
import { approvalSigningData } from '../shared/safeSignatures.ts';

assert.equal(process.env.CONVEX_DEPLOYMENT, 'dev:fortunate-cat-122');
assert.equal(process.env.VITE_CONVEX_URL, 'https://fortunate-cat-122.convex.cloud');
const dir = '.local/qa';
const nested = JSON.parse(readFileSync(`${dir}/account-approvals-evidence.json`));
const workspace = JSON.parse(readFileSync(`${dir}/workspace-report.json`));
const owner = privateKeyToAccount(JSON.parse(readFileSync(`${dir}/wallet.json`)).privateKey);
const second = privateKeyToAccount(JSON.parse(readFileSync(`${dir}/recipients.json`))[1]);
assert.equal(workspace.orgId, 'k575vpg8mtsn2126zbswdg4rfd8dvk88');
assert.equal(workspace.wallet, owner.address);
assert.equal(nested.orgId, workspace.orgId);
assert.equal(nested.complete, true);
const file = `${dir}/browser-payments-evidence.json`;
const report = existsSync(file) ? JSON.parse(readFileSync(file)) : { orgId: workspace.orgId, payroll: nested.payroll, chainId: 11155111, transactions: [], checks: [] };
assert.equal(report.orgId, workspace.orgId); assert.equal(report.payroll, nested.payroll); assert.equal(report.chainId, 11155111);
const save = () => writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
const pass = name => { if (!report.checks.includes(name)) report.checks.push(name); save(); console.log(`PASS ${name}`); };
const recheckUi = process.argv.includes('--recheck-ui');
if (report.complete && !recheckUi) { console.log('Built-browser acceptance already complete; no transaction repeated'); process.exit(0); }
if (recheckUi) assert.equal(report.complete, true, 'A completed payment is required for a read-only UI recheck');
const baseURL = 'http://127.0.0.1:4180';
assert.equal((await fetch(baseURL)).status, 200, 'Start the dedicated built QA preview on port 4180 first');
const rpc = process.env.QA_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const chain = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 20000, retryCount: 1 }) });
const wallet = createWalletClient({ chain: sepolia, transport: http(rpc), account: owner });
assert.equal(await chain.getChainId(), 11155111);
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: false });
async function login(account) {
  const { message } = await client.mutation(api.auth.generateNonce, { walletAddress: account.address });
  return (await client.mutation(api.auth.verifySignature, { walletAddress: account.address, message, signature: await account.signMessage({ message }) })).token;
}
async function broadcast(label, tx) {
  let record = report.transactions.find(t => t.label === label);
  if (!record) {
    const request = await wallet.prepareTransactionRequest({ ...tx, account: owner });
    const raw = await owner.signTransaction(request);
    record = { label, hash: keccak256(raw), raw }; report.transactions.push(record); save();
  }
  const receipt = await chain.getTransactionReceipt({ hash: record.hash }).catch(() => null);
  if (!receipt) await chain.sendRawTransaction({ serializedTransaction: record.raw }).catch(error => { if (!/already known|nonce too low|known transaction/i.test(String(error))) throw error; });
  return record.hash;
}
const adminToken = await login(owner), secondToken = await login(second);
const scope = { orgId: workspace.orgId, sessionToken: adminToken };
const sessions = [adminToken, secondToken];
const browser = await chromium.launch();
let lastPage;
try {
  if (!report.disbursementId) {
    report.disbursementId = (await client.mutation(api.paymentRuns.create, { ...scope, safeId: nested.safeId, chainId: 11155111, token: 'USDC', name: 'QA browser approval and wallet recovery', purpose: 'other', recipients: [{ beneficiaryId: workspace.beneficiaryIds[0], amount: '0.000001' }] })).disbursementId; save();
  }
  const identity = { disbursementId: report.disbursementId, sessionToken: adminToken };
  const payment = await client.query(api.disbursements.getWithRecipients, identity);
  assert.equal(payment.safeId, nested.safeId); assert.equal(payment.totalAmount, '0.000001'); assert.equal(payment.token, 'USDC');
  if (!report.funded && payment.status !== 'executed') {
    const txHash = await broadcast('Fund browser QA Payroll', { to: CHAIN_TOKENS[11155111].USDC.address, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [nested.payroll, 1n] }) });
    assert.equal((await chain.waitForTransactionReceipt({ hash: txHash, confirmations: 2, timeout: 180000 })).status, 'success');
    report.funded = true; save();
  }
  async function openWallet(account, sessionToken, theme) {
    const page = await openQaWallet({ browser, account, chain, orgId: workspace.orgId, theme, baseURL,
      onSession: token => sessions.push(token),
      signTypedData: async typed => {
          const current = await client.action(api.accountApprovals.forSigning, { ...identity, sessionToken });
          const expected = approvalSigningData(11155111, [nested.payroll, nested.parent], current.proposal.safeTransactionData);
          assert.equal(hashTypedData(typed), expected.hash);
          if (account.address === owner.address && !report.signatureDeclined) { report.signatureDeclined = true; save(); return { error: { code: 4001, message: 'User declined the approval signature' } }; }
          const signature = await account.signTypedData(typed);
          report.signingHash = current.proposal.safeTxHash; save();
          return { value: signature };
      },
      sendTransaction: async tx => {
          assert.equal(account.address, owner.address);
          assert.equal(tx.from.toLowerCase(), owner.address.toLowerCase());
          assert.equal(tx.to.toLowerCase(), nested.payroll.toLowerCase());
          assert.equal(BigInt(tx.value || '0'), 0n);
          const expected = await client.action(api.accountApprovals.execution, identity);
          assert.equal(tx.data, expected.data);
          if (!report.sendDeclined) { report.sendDeclined = true; save(); return { error: { code: 4001, message: 'User declined the send request' } }; }
          const hash = await broadcast('Built-browser nested payment', { to: expected.to, data: expected.data, value: 0n });
          report.paymentHash = hash; save();
          return { value: hash };
      },
    });
    lastPage = page;
    pass(`${theme}: wallet connection and real signed sign-in succeeded in the built app`);
    await page.goto(`${baseURL}/org/${workspace.orgId}/disbursements?focus=${report.disbursementId}`);
    await expect(page.getByRole('dialog', { name: 'Payment details' })).toBeVisible();
    return page;
  }
  const first = await openWallet(owner, adminToken, 'light');
  let current = await client.query(api.disbursements.getWithRecipients, identity);
  if (!current.safeTxHash) {
    const review = first.getByRole('dialog', { name: 'Payment details' });
    const expectDecline = !report.signatureDeclined;
    await review.getByRole('button', { name: 'Review in wallet', exact: true }).click();
    await review.getByRole('button', { name: 'Confirm approval in wallet', exact: true }).click();
    if (expectDecline) {
      await expect(review.getByRole('alert')).toContainText(/User (declined|rejected)/);
      assert.equal((await client.query(api.disbursements.getWithRecipients, identity)).safeTxHash, undefined);
      await first.reload();
      await review.getByRole('button', { name: 'Review in wallet', exact: true }).click();
      await review.getByRole('button', { name: 'Confirm approval in wallet', exact: true }).click();
    }
    await expect(review.getByRole('region', { name: /QA Treasury approval group approvals/ })).toContainText('1 of 2 approvals received');
    await expect(review.getByRole('button', { name: 'Send payment', exact: true })).toBeDisabled();
    pass('Declined approval survives reload and saves one signature without allowing early payment');
  }
  const other = await openWallet(second, secondToken, 'dark');
  current = await client.query(api.disbursements.getWithRecipients, identity);
  if (current.status !== 'executed' && !(await client.action(api.paymentExecution.approvalStatus, identity)).ready) {
    const review = other.getByRole('dialog', { name: 'Payment details' });
    await review.getByRole('button', { name: 'Approve', exact: true }).click();
    await review.getByRole('button', { name: 'Confirm approval in wallet', exact: true }).click();
    await expect(review.getByRole('region', { name: /QA Treasury approval group approvals/ })).toContainText('2 of 2 approvals received');
    await review.getByRole('region', { name: /QA Treasury approval group approvals/ }).scrollIntoViewIfNeeded();
    await other.screenshot({ path: `${dir}/built-nested-approvals-dark.png`, fullPage: true });
    pass('A second browser wallet completes the parent threshold on mobile');
  }
  await first.reload(); lastPage = first;
  const review = first.getByRole('dialog', { name: 'Payment details' });
  current = await client.query(api.disbursements.getWithRecipients, identity);
  if (current.status === 'proposed') {
    const expectDecline = !report.sendDeclined;
    await review.getByRole('button', { name: 'Send payment', exact: true }).click();
    if (expectDecline) {
    await expect(review.getByRole('button', { name: 'Retry original payment', exact: true })).toBeEnabled();
    assert.equal((await client.query(api.disbursements.getWithRecipients, identity)).txHash, undefined);
    await first.reload();
    await review.getByRole('button', { name: 'Retry original payment', exact: true }).scrollIntoViewIfNeeded();
    await first.screenshot({ path: `${dir}/built-wallet-declined-light.png`, fullPage: true });
    pass('Declining native send preserves the exact approved transaction and offers retry after reload');
    }
  }
  current = await client.query(api.disbursements.getWithRecipients, identity);
  if (current.status === 'relaying' && current.nativeExecution?.walletRejectedAt && !current.txHash)
    await review.getByRole('button', { name: 'Retry original payment', exact: true }).click();
  await expect(review.getByText('Paid', { exact: true })).toBeVisible({ timeout: 180000 });
  current = await client.query(api.disbursements.getWithRecipients, identity);
  assert.equal(current.safeTxHash, report.signingHash); assert.equal(current.totalAmount, '0.000001'); assert.equal(current.txHash, report.paymentHash);
  await first.reload();
  await expect(review.getByText('Paid', { exact: true })).toBeVisible();
  await first.screenshot({ path: `${dir}/built-payment-settled-light.png`, fullPage: true });
  pass(recheckUi ? 'Fresh built sessions retain the confirmed payment after wallet loading refactor; no additional transaction sent' : 'Retry broadcasts the original nested payment once and the built app confirms exact test-USDC settlement');
  report.complete = true; report.checkedAt = new Date().toISOString(); save();
} catch (error) {
  if (lastPage) { await lastPage.screenshot({ path: `${dir}/built-payment-failure.png`, fullPage: true }); console.log(`Browser stopped at ${new URL(lastPage.url()).pathname}`); }
  throw error;
} finally {
  await browser.close();
  await Promise.allSettled(sessions.map(token => client.mutation(api.auth.logout, { token })));
}
