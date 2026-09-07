/** Read-only settlement/report acceptance in the existing isolated development workspace. */
import { readFileSync, writeFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';
import { createPublicClient, erc20Abi, formatUnits, http } from 'viem';
import { sepolia } from 'viem/chains';
import { CHAIN_TOKENS } from '../shared/chains.ts';

if (!process.env.CONVEX_DEPLOYMENT?.startsWith('dev:') || !process.env.VITE_CONVEX_URL?.endsWith('.convex.cloud')) throw new Error('An explicit hosted development deployment is required');
const state = JSON.parse(readFileSync('.local/qa/workspace-report.json', 'utf8'));
const wallet = privateKeyToAccount(JSON.parse(readFileSync('.local/qa/wallet.json', 'utf8')).privateKey);
if (state.orgId !== 'k575vpg8mtsn2126zbswdg4rfd8dvk88' || state.wallet !== wallet.address || state.deployment !== process.env.CONVEX_DEPLOYMENT) throw new Error('Isolated QA identity mismatch');
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: false });
const nonce = await client.mutation(api.auth.generateNonce, { walletAddress: wallet.address });
const session = await client.mutation(api.auth.verifySignature, { walletAddress: wallet.address, message: nonce.message, signature: await wallet.signMessage({ message: nonce.message }) });
const sessionToken = session.token;
const evidence = { checkedAt: new Date().toISOString(), orgId: state.orgId, checks: [] };
const pass = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
try {
  const org = await client.query(api.orgs.get, { orgId: state.orgId, sessionToken });
  if (!org?.name.includes('QA')) throw new Error('This is not the isolated QA workspace');
  const scope = { orgId: state.orgId, sessionToken, environment: 'test' };
  if (process.argv.includes('--verify-chain')) {
    await client.action(api.paymentExecution.confirm, { sessionToken, disbursementId: 'jh76jstk46gsbb8tzcc2ws4gdn8dxwwj',
      txHash: '0x7754db8a62227955b745241cee3a18c48ad51a63f9e1e45b3c7c679c75e88fd8' });
    pass('The existing payment receipt and settlement timestamp were reverified from its Sepolia block without sending funds');
  }
  if (process.argv.includes('--sync-accounts')) {
    await client.action(api.deposits.syncForOrg, { ...scope, force: true });
    let coverage;
    for (let attempt = 0; attempt < 90; attempt++) {
      coverage = await client.query(api.depositsData.statusForOrg, scope);
      if (coverage.some(s => s.error)) throw new Error(`Account history needs retry: ${coverage.find(s => s.error).error}`);
      if (coverage.length && coverage.every(s => s.includesOutgoing && !s.syncing)) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!coverage?.length || coverage.some(s => !s.includesOutgoing || s.syncing)) throw new Error('Complete account scan did not finish within the acceptance timeout');
    evidence.coverage = coverage;
    pass('The QA Safe completed an incoming and outgoing history scan');
  }
  await client.mutation(api.reportIndex.refresh, { orgId: state.orgId, sessionToken });
  let first;
  for (let attempt = 0; attempt < 30; attempt++) {
    first = await client.query(api.reports.getTransactionReport, { ...scope, pageSize: 3 });
    if (first.indexErrors.length) throw new Error(`History update failed: ${first.indexErrors[0]}`);
    if (!first.indexing) break;
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  if (first.indexing) throw new Error('Report history did not finish within the acceptance timeout');
  pass('Development history backfill and aggregate jobs completed');
  const items = [...first.items]; let page = first, pages = 1;
  while (!page.isDone) {
    if (++pages > 100) throw new Error('Unexpectedly large QA history');
    page = await client.query(api.reports.getTransactionReport, { ...scope, pageSize: 3, cursor: page.continueCursor, snapshotVersion: first.indexVersion });
    if (page.indexVersion !== first.indexVersion) throw new Error('History changed during acceptance');
    items.push(...page.items);
  }
  if (new Set(items.map(row => row.rowId)).size !== items.length) throw new Error('Duplicate reconciliation identifiers');
  if (!items.every(row => row.environment === 'test' && row.chainId === 11155111)) throw new Error('Another environment entered the QA report');
  evidence.rowCount = items.length; evidence.pages = pages; evidence.indexVersion = first.indexVersion;
  pass('Real cursor pages retain unique reconciliation IDs and test environment');
  const recovery = items.filter(row => row.sourceId === 'jh76jstk46gsbb8tzcc2ws4gdn8dxwwj' && row.kind === 'payment');
  if (recovery.length !== 1 || recovery[0].amount !== '0.000001' || recovery[0].txHash !== '0x7754db8a62227955b745241cee3a18c48ad51a63f9e1e45b3c7c679c75e88fd8') throw new Error('The previously verified Sepolia settlement did not reconcile exactly');
  pass('Previously settled native-gas payment retains its exact principal and transaction hash');
  if (process.argv.includes('--verify-chain')) {
    if (recovery[0].dateSource !== 'settlement' || !recovery[0].blockHash || !recovery[0].observedAt || recovery[0].createdAt > recovery[0].observedAt) throw new Error('Verified settlement evidence is missing from the report');
    evidence.settlement = { settledAt: recovery[0].createdAt, observedAt: recovery[0].observedAt, blockNumber: recovery[0].blockNumber, blockHash: recovery[0].blockHash };
    pass('Report distinguishes the actual settlement timestamp from app observation time');
  }
  if (process.argv.includes('--sync-accounts')) {
    if (!recovery[0].transferId || recovery[0].amountRaw !== '1') throw new Error('The confirmed payment did not match its unique chain transfer');
    if (!items.some(row => row.direction === 'inflow')) throw new Error('Expected QA funding receipts were not indexed');
    evidence.matchedTransferId = recovery[0].transferId;
    pass('Previously confirmed payment appears once and matches its raw on-chain transfer; funding receipts are included');
    const network = createPublicClient({ chain: sepolia, transport: http(process.env.RPC_URL_11155111 || sepolia.rpcUrls.default.http[0], { timeout: 15_000 }) });
    const safe = (await client.query(api.safes.getForOrg, { orgId: state.orgId, sessionToken })).find(s => s.chainId === 11155111);
    if (!safe || safe.safeAddress.toLowerCase() !== '0x17fc8c99f7e823eB73b5325a0A7699f7e9c729c7'.toLowerCase()) throw new Error('Unexpected QA funding account');
    const blockNumber = await network.getBlockNumber();
    const usdc = CHAIN_TOKENS[11155111].USDC;
    const balance = await network.readContract({ address: usdc.address, abi: erc20Abi, functionName: 'balanceOf', args: [safe.safeAddress], blockNumber });
    const net = first.totals.find(t => t.assetId === `11155111:${usdc.address.toLowerCase()}`)?.net;
    if (formatUnits(balance, usdc.decimals) !== net) throw new Error('The full USDC transfer history does not reconcile with the Safe balance');
    evidence.balanceCheck = { chainId: 11155111, tokenAddress: usdc.address, blockNumber: String(blockNumber), balance: formatUnits(balance, usdc.decimals), reportNet: net };
    pass('Full recorded USDC inflows less outflows reconcile exactly to the Safe token balance at a recorded block');
  }
  const spending = await client.query(api.reports.getSpendingByBeneficiary, scope);
  if (spending.indexing || !spending.items.length || !spending.items.every(row => row.environment === 'test')) throw new Error('Recipient aggregates are missing or incomplete');
  pass('Recipient spending aggregates are available from the live development database');
  evidence.totals = first.totals.map(({ assetId, inflow, outflow, net }) => ({ assetId, inflow, outflow, net }));
  writeFileSync('.local/qa/report-index-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
} finally { await client.mutation(api.auth.logout, { token: sessionToken }); }
