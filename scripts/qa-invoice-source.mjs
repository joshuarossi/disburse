/** Upload/download/receipt acceptance using only the existing isolated QA org. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

if (!process.env.CONVEX_DEPLOYMENT?.startsWith('dev:') || !process.env.VITE_CONVEX_URL?.endsWith('.convex.cloud')) throw new Error('An explicit hosted development deployment is required.');
const state = JSON.parse(readFileSync('.local/qa/workspace-report.json','utf8'));
const wallet = privateKeyToAccount(JSON.parse(readFileSync('.local/qa/wallet.json','utf8')).privateKey);
if (state.orgId !== 'k575vpg8mtsn2126zbswdg4rfd8dvk88' || state.wallet !== wallet.address || state.deployment !== process.env.CONVEX_DEPLOYMENT) throw new Error('Isolated QA identity mismatch');
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: false });
const hash = value => createHash('sha256').update(value).digest('hex');
const body = 'Invoice number: QA-SOURCE-20260906\nDue date: 2026-09-30\nAmount due: USDC 0.01\nIsolated software acceptance fixture; no payment requested.\n';
const site = process.env.VITE_CONVEX_URL.replace(/\.cloud$/, '.site');
const nonce = await client.mutation(api.auth.generateNonce, { walletAddress: wallet.address });
const session = await client.mutation(api.auth.verifySignature, { walletAddress: wallet.address, message: nonce.message, signature: await wallet.signMessage({ message: nonce.message }) });
const sessionToken = session.token;
const evidence = { checkedAt: new Date().toISOString(), orgId: state.orgId, checks: [] };
const pass = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
try {
  const org = await client.query(api.orgs.get, { orgId: state.orgId, sessionToken });
  if (!org?.name.includes('QA')) throw new Error('This is not the isolated QA workspace');
  const headers = { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'text/plain', 'X-File-Name': 'qa-source-invoice.txt', 'X-Request-Id': hash('qa-invoice-source-20260906-upload') };
  const send = async () => {
    const response = await fetch(`${site}/invoice-files?orgId=${state.orgId}`, { method: 'POST', headers, body, redirect: 'error' });
    if (!response.ok) throw new Error(`Source upload rejected (${response.status})`);
    return response.json();
  };
  const first = await send(), second = await send();
  if (first.fileId !== second.fileId || first.sha256 !== hash(body)) throw new Error('Upload identity or checksum mismatch');
  evidence.fileId = first.fileId; evidence.sha256 = first.sha256;
  pass('Real private upload and duplicate-response recovery');
  const unauthenticated = await fetch(`${site}/invoice-files?fileId=${first.fileId}`);
  if (unauthenticated.status !== 403) throw new Error('Private source was exposed without authentication');
  pass('Unauthenticated download denied');
  const recipients = await client.query(api.beneficiaries.list, { orgId: state.orgId, sessionToken, activeOnly: true });
  const recipient = recipients.find(r => r.isActive);
  if (!recipient) throw new Error('An isolated QA recipient is required');
  const fields = { orgId: state.orgId, sessionToken, beneficiaryId: recipient._id, invoiceNumber: 'QA-SOURCE-20260906', amount: '0.01', token: 'USDC', dueDate: Date.UTC(2026,8,30,23,59,59), description: 'Software acceptance fixture. Do not pay.', sourceFileIds: [first.fileId], sourceReviewed: true, requestId: hash('qa-invoice-source-20260906-bill') };
  const invoiceId = await client.mutation(api.invoices.create, fields);
  if (await client.mutation(api.invoices.create, fields) !== invoiceId) throw new Error('Bill creation did not recover the same receipt');
  evidence.invoiceId = invoiceId;
  const files = await client.query(api.invoiceFiles.list, { invoiceId, sessionToken });
  if (files.length !== 1 || files[0].sha256 !== hash(body)) throw new Error('Saved source link mismatch');
  pass('Reviewed bill source saved once and checksum retained');
  const response = await fetch(`${site}/invoice-files?fileId=${first.fileId}`, { headers: { Authorization: `Bearer ${sessionToken}` }, redirect: 'error' });
  if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== hash(body)) throw new Error('Private download bytes did not match');
  if (response.headers.get('cache-control') !== 'no-store' || !response.headers.get('content-disposition')?.startsWith('attachment;')) throw new Error('Download protection headers missing');
  pass('Authenticated download preserves bytes and download headers');
  await client.mutation(api.invoices.voidBill, { invoiceId, sessionToken });
  pass('QA-only bill voided without preparing or sending a payment');
  writeFileSync('.local/qa/invoice-source-evidence.json', JSON.stringify(evidence,null,2)+'\n');
} finally { await client.mutation(api.auth.logout, { token: sessionToken }); }
