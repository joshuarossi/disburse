/** Built-app licensing acceptance on the isolated development QA organization.
 * Temporarily authorizes its QA signer as a dev license operator, grants Pro,
 * then restores normal access and the previous allowlist. Never sends money.
 * A journal supports --restore after an interrupted run. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { api } from '../convex/_generated/api.js';
import { openQaWallet } from './lib/qaBrowserWallet.mjs';

const deployment = 'fortunate-cat-122';
const orgId = 'k575vpg8mtsn2126zbswdg4rfd8dvk88';
const baseURL = process.env.QA_BASE_URL ?? 'http://127.0.0.1:4190';
const stateFile = '.local/qa/license-acceptance-state.json';
const evidenceFile = '.local/qa/license-acceptance-evidence.json';
assert.equal(process.env.CONVEX_DEPLOYMENT, `dev:${deployment}`);
assert.equal(process.env.VITE_CONVEX_URL, `https://${deployment}.convex.cloud`);
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname));
const account = privateKeyToAccount(JSON.parse(fs.readFileSync('.local/qa/wallet.json', 'utf8')).privateKey);
assert.equal(account.address.toLowerCase(), '0x01585228489577cdCdbd5eBb822C7c439a2c564c'.toLowerCase());
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL);
const sessions = [];
let browser, journal, restored = false;
const save = () => fs.writeFileSync(stateFile, JSON.stringify(journal, null, 2), { mode: 0o600 });
function env(...args) {
  const result = spawnSync('bunx', ['convex', 'env', '--deployment-name', deployment, ...args], { encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) throw new Error(`QA operator configuration failed: ${args[0]}`);
  return result.stdout.trim();
}
async function signIn() {
  const { message } = await client.mutation(api.auth.generateNonce, { walletAddress: account.address });
  const { token } = await client.mutation(api.auth.verifySignature, { walletAddress: account.address, message, signature: await account.signMessage({ message }) });
  sessions.push(token); return token;
}
async function restoreLicense(sessionToken) {
  const current = await client.query(api.licenseAdmin.company, { orgId, sessionToken });
  if (current.billing.licenseGrant) {
    assert.equal(current.billing.licenseGrant.kind, 'complimentary');
    assert.equal(current.billing.licenseGrant.tier.key, 'pro');
    assert.equal(current.billing.licenseRevision, journal.before.licenseRevision + 1);
    await client.mutation(api.licenseAdmin.changeCompany, { orgId, sessionToken, requestId: journal.restoreRequestId, reason: 'Restore isolated QA company access after built-browser license acceptance', expectedRevision: current.billing.licenseRevision, mode: 'standard', tierKey: journal.before.plan, fallbackTierKey: journal.before.fallbackKey });
  }
  const after = await client.query(api.billing.get, { orgId, sessionToken });
  assert.equal(after.licenseGrant, undefined);
  assert.equal(after.plan, journal.before.plan);
  if (journal.before.status !== undefined) assert.equal(after.billingStatus, journal.before.status);
  assert.equal(after.trialEndsAt, journal.before.trialEndsAt);
  assert.equal(after.paidThroughAt, journal.before.paidThroughAt);
  assert.equal(after.payments.length, journal.before.paymentCount);
  restored = true;
}

try {
  const sessionToken = await signIn();
  await client.query(api.licenseAdmin.access, { sessionToken });
  const earlier = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
  if (process.argv.includes('--restore')) {
    assert.ok(earlier && earlier.phase !== 'complete', 'No interrupted license acceptance to restore');
    journal = earlier;
    env('set', 'DISBURSE_LICENSE_OPERATORS', [...new Set([...env('get', 'DISBURSE_LICENSE_OPERATORS').split(/[\s,]+/).filter(Boolean), account.address])].join(','));
    await restoreLicense(sessionToken);
  } else {
    assert.ok(!earlier || earlier.phase === 'complete', 'Run this script with --restore before starting a new acceptance');
    const before = await client.query(api.billing.get, { orgId, sessionToken });
    assert.ok(before); assert.equal(before.licenseGrant, undefined);
    const priorOperators = env('get', 'DISBURSE_LICENSE_OPERATORS');
    const temporaryOperators = [...new Set([...priorOperators.split(/[\s,]+/).filter(Boolean), account.address])].join(',');
    journal = { phase: 'prepared', orgId, priorOperators, temporaryOperators, restoreRequestId: crypto.randomUUID(),
      before: { plan: before.plan, status: before.billingStatus, trialEndsAt: before.trialEndsAt, paidThroughAt: before.paidThroughAt, licenseRevision: before.licenseRevision ?? 0, fallbackKey: before.fallbackTier?.key ?? 'free', paymentCount: before.payments.length } };
    save(); env('set', 'DISBURSE_LICENSE_OPERATORS', temporaryOperators); journal.phase = 'authorized'; save();
    assert.equal((await client.query(api.licenseAdmin.access, { sessionToken })).allowed, true);
    browser = await chromium.launch();
    const forbidden = async () => { throw new Error('Licensing QA does not authorize an on-chain transaction'); };
    const page = await openQaWallet({ browser, account, chain: createPublicClient({ chain: sepolia, transport: http() }), orgId, theme: 'light', baseURL,
      signTypedData: forbidden, signRawMessage: forbidden, sendTransaction: forbidden, onSession: token => sessions.push(token) });
    await page.goto(`${baseURL}/admin/licenses`);
    const company = await client.query(api.licenseAdmin.company, { orgId, sessionToken });
    await page.getByLabel('Find a company').fill(company.org.name);
    await page.getByRole('button', { name: 'Search companies' }).click();
    await page.getByRole('region', { name: 'Companies', exact: true }).getByRole('button').filter({ hasText: orgId }).click();
    await page.getByLabel('Access arrangement').selectOption('complimentary');
    await page.getByLabel('Access tier', { exact: true }).selectOption('pro');
    await expect(page.getByLabel('Never expires')).toBeChecked();
    await page.getByLabel('Reason for this change').fill('Temporary complimentary Pro for isolated built-browser QA, restored at completion');
    await page.getByRole('button', { name: 'Save company license' }).click();
    await expect(page.getByRole('status')).toContainText('Company license saved');
    const granted = await client.query(api.billing.get, { orgId, sessionToken });
    assert.equal(granted.source, 'complimentary'); assert.equal(granted.effectiveTier.key, 'pro'); assert.equal(granted.expiresAt, null);
    assert.equal(granted.payments.length, before.payments.length);
    journal.phase = 'granted'; save();
    await page.screenshot({ path: '.local/qa/built-license-operator.png', fullPage: true });
    await page.goto(`${baseURL}/org/${orgId}/settings?tab=billing`);
    await expect(page.getByText('No subscription charge', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Included at no charge' })).toHaveCount(2);
    await page.reload();
    await expect(page.getByText('No subscription charge', { exact: true })).toBeVisible();
    await page.screenshot({ path: '.local/qa/built-license-complimentary.png', fullPage: true });
    await restoreLicense(sessionToken);
    fs.writeFileSync(evidenceFile, JSON.stringify({ at: new Date().toISOString(), deployment, orgId, realBackend: true, builtBrowser: true, complimentaryGrant: true, billingReload: true, paymentHistoryUnchanged: true, restored: true, networkTransactions: 0 }, null, 2));
    console.log('Built-browser grant, billing reload and license restoration passed. No subscription payment was created.');
  }
} finally {
  try {
    if (journal && !restored) await restoreLicense(await signIn());
  } finally {
    if (journal) {
      const current = env('get', 'DISBURSE_LICENSE_OPERATORS');
      if (current === journal.temporaryOperators) {
        if (journal.priorOperators) env('set', 'DISBURSE_LICENSE_OPERATORS', journal.priorOperators); else env('remove', 'DISBURSE_LICENSE_OPERATORS');
      } else {
        const hadQa = journal.priorOperators.split(/[\s,]+/).some(a => a.toLowerCase() === account.address.toLowerCase());
        if (!hadQa) {
          const remaining = current.split(/[\s,]+/).filter(a => a && a.toLowerCase() !== account.address.toLowerCase()).join(',');
          if (remaining) env('set', 'DISBURSE_LICENSE_OPERATORS', remaining); else env('remove', 'DISBURSE_LICENSE_OPERATORS');
        }
      }
      journal.phase = restored ? 'complete' : 'needs_restore'; save();
    }
    await browser?.close();
    for (const token of sessions) await client.mutation(api.auth.logout, { token });
  }
}
