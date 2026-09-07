/** Real Sepolia allowance acceptance. Reuses only the isolated QA Safe. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  erc20Abi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import Safe from "@safe-global/protocol-kit";
import { getAllowanceModuleDeployment } from "@safe-global/safe-modules-deployments";
import {
  buildAllowanceGrant,
  buildAllowanceRevocation,
  getAllowanceDeployments,
  readAllowanceSnapshot,
} from "../src/lib/safeAllowance.ts";
import { CHAIN_TOKENS } from "../shared/chains.ts";
const dir = ".local/qa";
const { privateKey } = JSON.parse(readFileSync(`${dir}/wallet.json`));
const owner = privateKeyToAccount(privateKey);
const baseline = JSON.parse(readFileSync(`${dir}/testnet-report.json`));
if (
  baseline.chainId !== 11155111 ||
  baseline.wallet !== owner.address ||
  !baseline.transactions.some(
    (t) => t.label === "Execute exact USDC batch" && t.status === "success",
  )
)
  throw new Error("Complete the isolated Sepolia batch first");
const rpc =
  process.env.QA_SEPOLIA_RPC_URL ||
  process.env.VITE_SEPOLIA_RPC_URL ||
  sepolia.rpcUrls.default.http[0];
const client = createPublicClient({
  chain: sepolia,
  transport: http(rpc, { timeout: 20000 }),
});
if ((await client.getChainId()) !== 11155111) throw new Error("Sepolia only");
const ownerWallet = createWalletClient({
  chain: sepolia,
  transport: http(rpc),
  account: owner,
});
const [recipient, delegate] = JSON.parse(
  readFileSync(`${dir}/recipients.json`),
).map(privateKeyToAccount);
const delegateWallet = createWalletClient({
  chain: sepolia,
  transport: http(rpc),
  account: delegate,
});
const safe = baseline.safe,
  token = CHAIN_TOKENS[11155111].USDC.address;
const module = getAllowanceDeployments(11155111)[0];
const abi = getAllowanceModuleDeployment({
  network: "11155111",
  version: module.version,
}).abi;
const path = `${dir}/allowance-report.json`;
const report = existsSync(path)
  ? JSON.parse(readFileSync(path))
  : {
      safe,
      module: module.address,
      delegate: delegate.address,
      transactions: [],
      checks: [],
    };
if (report.safe !== safe || report.delegate !== delegate.address)
  throw new Error("Wrong QA state");
const save = () => writeFileSync(path, JSON.stringify(report, null, 2));
if (report.complete) {
  console.log(
    "Allowance acceptance already completed; no new transactions sent",
  );
  process.exit(0);
}
const sdk = await Safe.init({
  provider: rpc,
  signer: privateKey,
  safeAddress: safe,
});
async function send(label, tx, sender = ownerWallet) {
  let entry = report.transactions.find((t) => t.label === label);
  if (!entry) {
    entry = {
      label,
      hash: await sender.sendTransaction({
        ...tx,
        value: BigInt(tx.value || 0),
      }),
      status: "submitted",
    };
    report.transactions.push(entry);
    save();
  }
  const receipt = await client.waitForTransactionReceipt({
    hash: entry.hash,
    confirmations: 2,
    timeout: 180000,
  });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  entry.status = "success";
  save();
  console.log(`${label}: https://sepolia.etherscan.io/tx/${entry.hash}`);
}
async function safeCall(label, transactions) {
  report.prepared ??= {};
  if (!report.prepared[label]) {
    const tx = await sdk.signTransaction(
      await sdk.createTransaction({ transactions }),
    );
    report.prepared[label] = await sdk.getEncodedTransaction(tx);
    save();
  }
  await send(label, { to: safe, data: report.prepared[label] });
}
function pass(name) {
  if (!report.checks.includes(name)) report.checks.push(name);
  save();
  console.log(`PASS ${name}`);
}
const transfer = (amount) => ({
  address: module.address,
  abi,
  functionName: "executeAllowanceTransfer",
  args: [
    safe,
    token,
    recipient.address,
    amount,
    zeroAddress,
    0n,
    delegate.address,
    "0x",
  ],
  account: delegate,
});
async function denied(name, amount) {
  try {
    await client.simulateContract(transfer(amount));
  } catch (e) {
    if (!String(e).includes("revert")) throw e;
    pass(name);
    return;
  }
  throw new Error(`${name}: unexpectedly permitted`);
}
if (!report.revocationStarted) {
  const snapshot = await readAllowanceSnapshot(11155111, safe, module.address);
  await safeCall(
    "Grant one USDC allowance",
    buildAllowanceGrant({
      chainId: 11155111,
      safe,
      module: module.address,
      delegate: delegate.address,
      token: "USDC",
      amount: "1",
      resetMinutes: 0,
      moduleEnabled: snapshot.moduleEnabled,
      delegateExists: snapshot.delegates.some(
        (a) => a.toLowerCase() === delegate.address.toLowerCase(),
      ),
    }),
  );
  await send("Fund delegate gas", {
    to: delegate.address,
    value: 1_000_000_000_000_000n,
  });
  if (!report.before) {
    report.before = String(
      await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [recipient.address],
      }),
    );
    save();
  }
  await send(
    "Delegate pays 0.4 USDC",
    { to: module.address, data: encodeFunctionData(transfer(400000n)) },
    delegateWallet,
  );
  const after = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [recipient.address],
  });
  if (after - BigInt(report.before) !== 400000n)
    throw new Error("Wrong delegated payment amount");
  pass("Exact delegated recipient balance");
  const current = await readAllowanceSnapshot(11155111, safe, module.address);
  const row = current.allowances.find(
    (a) =>
      a.delegate.toLowerCase() === delegate.address.toLowerCase() &&
      a.token.toLowerCase() === token.toLowerCase(),
  );
  if (!row || row.amount !== 1000000n || row.spent !== 400000n)
    throw new Error("Allowance accounting mismatch");
  pass("Contract records one USDC limit and 0.4 spent");
  await denied("Exceeding remaining 0.6 USDC is rejected", 600001n);
  report.revocationStarted = true;
  save();
}
await safeCall(
  "Revoke USDC allowance",
  buildAllowanceRevocation(11155111, module.address, delegate.address, token),
);
await denied("Spending after revocation is rejected", 1n);
const final = await readAllowanceSnapshot(11155111, safe, module.address);
if (
  final.allowances.some(
    (a) =>
      a.delegate.toLowerCase() === delegate.address.toLowerCase() &&
      a.token.toLowerCase() === token.toLowerCase(),
  )
)
  throw new Error("Revoked allowance still shown");
pass("App snapshot no longer shows revoked grant");
report.complete = true;
report.checkedAt = new Date().toISOString();
save();
console.log("PASS live allowance grant, spend, limit and revocation");
