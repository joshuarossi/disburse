// Real application service + dev Convex + canonical Base Sepolia USDC.
// No native broadcast, provider account or private key in the output.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ConvexHttpClient } from 'convex/browser';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { erc20Abi, encodeFunctionData, keccak256, toHex } from 'viem';
import Safe from '@safe-global/protocol-kit';
import { api } from '../convex/_generated/api.js';
import { customerPaidSafeConfig } from '../shared/safe4337.ts';
import { quoteCustomerExecution, serviceReader, serviceRequest } from '../src/lib/services/customerExecution.ts';
import { authorizeCustomerExecution } from '../src/lib/services/permitAuthorization.ts';
import { userErrorMessage } from '../src/lib/userErrors.ts';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const run = option('run');
if (!run || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(run)) throw new Error('Choose a unique --run=name. Use --status to recover a recorded request.');
const execute = process.argv.includes('--execute'), status = process.argv.includes('--status');
if (execute && status) throw new Error('Choose execution or status checking, not both.');
if (!process.env.CONVEX_DEPLOYMENT?.startsWith('dev:') || process.env.VITE_CONVEX_URL !== 'https://fortunate-cat-122.convex.cloud') throw new Error('This runner only uses the isolated development backend.');
const directory = '.local/qa/customer-setup';
await mkdir(directory, { recursive: true, mode: 0o700 });
const path = `${directory}/${run}.json`;
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const existing = await readFile(path, 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
if (existing && !status) throw new Error('This run is recorded. Check its original status; do not submit it again.');
if (status && !existing?.operationId) throw new Error('This run has no submitted application request. No provider submission will be attempted.');
const owner = privateKeyToAccount(JSON.parse(await readFile('.local/qa/wallet.json', 'utf8')).privateKey);
const reader = serviceReader(baseSepolia.id);
if (await reader.getChainId() !== baseSepolia.id) throw new Error('The reader is on a different network.');
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: false });
let sessionToken;
async function signIn() {
  const nonce = await client.mutation(api.auth.generateNonce, { walletAddress: owner.address });
  const auth = await client.mutation(api.auth.verifySignature, { walletAddress: owner.address, message: nonce.message, signature: await owner.signMessage({ message: nonce.message }) });
  sessionToken = auth.token;
}
const token = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
try {
  if (status) {
    if (existing.owner !== owner.address || existing.chainId !== baseSepolia.id) throw new Error('The saved run belongs to another wallet or network.');
    await signIn();
    const identity = { operationId: existing.operationId, sessionToken };
    const result = await client.action(api.customerExecution.refresh, identity);
    let linked;
    if (result.state === 'confirmed') linked = await client.action(api.customerExecution.completeSetup, identity);
    const [walletUSDC, accountUSDC, walletETH, accountETH] = await Promise.all([
      reader.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] }),
      reader.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [existing.account.address] }),
      reader.getBalance({ address: owner.address }), reader.getBalance({ address: existing.account.address }),
    ]);
    if (result.state === 'confirmed' && accountUSDC < BigInt(existing.record.intent.amount)) throw new Error('The new account does not contain its approved initial deposit.');
    const output = { ...result, ...linked, account: existing.account.address, initialWalletETH: existing.initialWalletETH, walletUSDC, accountUSDC, walletETH, accountETH };
    await writeFile(path, json({ ...existing, result: output }), { mode: 0o600 });
    console.log(json(output));
  } else {
    const initialWalletETH = await reader.getBalance({ address: owner.address });
    if (initialWalletETH !== 0n) throw new Error('Original onboarding QA requires zero native ETH in the signing wallet.');
    let orgId;
    if (execute) {
      await signIn();
      // Claim the local run before creating a workspace or asking the provider.
      await writeFile(path, json({ stage: 'preparing', owner: owner.address, chainId: baseSepolia.id }), { flag: 'wx', mode: 0o600 });
      ({ orgId } = await client.mutation(api.orgs.create, { sessionToken, name: `Customer-paid setup QA ${run}` }));
      await writeFile(path, json({ stage: 'preparing', owner: owner.address, chainId: baseSepolia.id, orgId }), { mode: 0o600 });
    }
    const config = customerPaidSafeConfig(baseSepolia.id, [owner.address], 1);
    const safe = await Safe.init({ provider: baseSepolia.rpcUrls.default.http[0], predictedSafe: { safeAccountConfig: config, safeDeploymentConfig: { safeVersion: '1.4.1', saltNonce: BigInt(keccak256(toHex(orgId ?? `qa:${run}`))).toString() } } });
    const address = await safe.getAddress(), deploy = await safe.createSafeDeploymentTransaction();
    if (await reader.getCode({ address })) throw new Error('This account already exists. The runner will not redeploy or fund it again.');
    const prepared = await quoteCustomerExecution({ chainId: baseSepolia.id, owner: owner.address, amount: 1_000_000n, calls: [
      { to: deploy.to, data: deploy.data, value: BigInt(deploy.value || '0') },
      { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [address, 1_000_000n] }), value: 0n },
    ] });
    if (prepared.fee > 100_000n) throw new Error('The quote exceeds this test’s 0.10 USDC fee limit.');
    if (!execute) console.log(json({ state: 'simulation_passed', account: address, fee: prepared.fee, initialWalletETH }));
    else {
      // Production uses the connected EIP-1193 wallet. The QA signer performs
      // that same typed-data request locally, never on a public RPC server.
      const wallet = { getAddresses: async () => [owner.address], getChainId: () => reader.getChainId(), signTypedData: async ({ account, ...data }) => {
        if (account !== owner.address) throw new Error('The requested test signer changed.');
        return owner.signTypedData(data);
      } };
      const payload = await authorizeCustomerExecution(prepared, wallet, reader);
      const account = { address, owners: [owner.address], threshold: 1 };
      const record = { intent: { ...prepared.intent, amount: prepared.intent.amount.toString(), calls: prepared.intent.calls.map(call => ({ ...call, value: call.value.toString() })) }, quote: prepared.quote, startBlock: prepared.startBlock.toString(), account };
      const state = { owner: owner.address, chainId: baseSepolia.id, orgId, account, record, initialWalletETH: initialWalletETH.toString(), hash: prepared.quote.hash, fee: prepared.fee.toString() };
      await writeFile(path, json({ ...state, stage: 'saving' }), { mode: 0o600 });
      const operationId = await client.mutation(api.customerOperations.begin, { orgId, sessionToken, record: JSON.stringify(record) });
      await writeFile(path, json({ ...state, operationId, stage: 'submitting' }), { mode: 0o600 });
      // Exactly one request. Even a service rejection must check the original
      // hashes through the application’s canonical-chain recovery action.
      try {
        const result = await serviceRequest('exec', payload);
        if (result?.hash?.toLowerCase() !== state.hash.toLowerCase()) throw new Error('The provider returned a different execution hash.');
        console.log(json({ state: 'submitted', operationId, account: address, hash: state.hash, fee: prepared.fee, initialWalletETH }));
      } catch (error) {
        await writeFile(path, json({ ...state, operationId, stage: 'check_original', submissionError: error.message }), { mode: 0o600 });
        console.log(json({ state: 'check_original', operationId, account: address, hash: state.hash, error: error.message }));
      }
    }
  }
} catch (error) {
  console.error(json({ state: 'stopped', error: userErrorMessage(error, 'The test stopped. Inspect the saved run before preparing another request.') }));
  process.exitCode = 1;
} finally {
  if (sessionToken) await client.mutation(api.auth.logout, { token: sessionToken }).catch(() => {});
}
