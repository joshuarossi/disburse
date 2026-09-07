/** Read-only verification of a completed isolated QA proposal against current Safe identity. */
import { readFileSync } from 'node:fs';
import { ConvexHttpClient } from 'convex/browser';
import { privateKeyToAccount } from 'viem/accounts';
import { api } from '../convex/_generated/api.js';
if (!process.env.CONVEX_DEPLOYMENT?.startsWith('dev:')) throw new Error('Development backend only');
const c = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: false });
const a = privateKeyToAccount(JSON.parse(readFileSync('.local/qa/wallet.json')).privateKey);
const workspace = JSON.parse(readFileSync('.local/qa/workspace-report.json'));
const r = JSON.parse(readFileSync('.local/qa/two-owner-workspace-report-v2.json'));
if (workspace.deployment !== process.env.CONVEX_DEPLOYMENT || workspace.wallet !== a.address || r.orgId !== workspace.orgId) throw new Error('Wrong QA workspace');
const { message } = await c.mutation(api.auth.generateNonce, { walletAddress: a.address });
const { token } = await c.mutation(api.auth.verifySignature, { walletAddress: a.address, message, signature: await a.signMessage({ message }) });
try {
  const status = await c.action(api.paymentExecution.approvalStatus, { disbursementId: r.disbursementId, sessionToken: token });
  if (status.threshold !== 1 || status.ready || status.currentNonce <= status.proposalNonce) throw new Error('Historical proposal reported incorrect current authority');
  console.log('PASS backend verifies canonical Safe identity, ignores a removed owner signature and prevents replay of a consumed proposal');
} finally { await c.mutation(api.auth.logout, { token }); }
