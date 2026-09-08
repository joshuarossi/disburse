/** Historical native-gas protocol diagnostic. Customer-paid acceptance uses qa-circle-receiving.mjs. Never prints keys or sessions. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  parseAbi,
  getContractAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { api } from "../convex/_generated/api.js";
import { forwarderFactory, sweepCall } from "../shared/receivableAddress.ts";
import { CHAIN_TOKENS } from "../shared/chains.ts";

if (!process.env.CONVEX_DEPLOYMENT?.startsWith("dev:"))
  throw new Error("Development backend only");
const dir = ".local/qa";
const baseline = JSON.parse(readFileSync(`${dir}/testnet-report.json`));
const workspace = JSON.parse(readFileSync(`${dir}/workspace-report.json`));
const owner = privateKeyToAccount(
  JSON.parse(readFileSync(`${dir}/wallet.json`)).privateKey,
);
if (
  baseline.wallet !== owner.address ||
  workspace.wallet !== owner.address ||
  baseline.chainId !== sepolia.id ||
  workspace.deployment !== process.env.CONVEX_DEPLOYMENT
)
  throw new Error("Wrong isolated QA state");
const rpc =
  process.env.QA_SEPOLIA_RPC_URL ||
  process.env.VITE_SEPOLIA_RPC_URL ||
  sepolia.rpcUrls.default.http[0];
const chain = createPublicClient({
  chain: sepolia,
  transport: http(rpc, { timeout: 20000 }),
});
const wallet = createWalletClient({
  account: owner,
  chain: sepolia,
  transport: http(rpc),
});
if ((await chain.getChainId()) !== sepolia.id) throw new Error("Sepolia only");
const path = `${dir}/receivable-report.json`;
const report = existsSync(path)
  ? JSON.parse(readFileSync(path))
  : {
      chainId: sepolia.id,
      orgId: workspace.orgId,
      safe: baseline.safe,
      steps: {},
      checks: [],
    };
if (
  report.safe !== baseline.safe ||
  report.orgId !== workspace.orgId ||
  report.chainId !== sepolia.id
)
  throw new Error("Wrong QA report");
const save = () =>
  writeFileSync(path, JSON.stringify(report, null, 2), { mode: 0o600 });
const pass = (name) => {
  if (!report.checks.includes(name)) report.checks.push(name);
  save();
  console.log(`PASS ${name}`);
};
const budget = 10_000_000_000_000_000n; // 0.01 Sepolia ETH total ceiling, including the factory.
async function send(label, request) {
  let step = report.steps[label];
  if (!step) {
    const estimate = await chain.estimateGas({
      ...request,
      account: owner.address,
    });
    const gas = (estimate * 120n) / 100n;
    const fees = await chain.estimateFeesPerGas();
    const spent = Object.values(report.steps).reduce(
      (n, s) => n + BigInt(s.actualFee ?? s.maxFee ?? "0"),
      0n,
    );
    if (spent + gas * fees.maxFeePerGas > budget)
      throw new Error("QA gas budget exceeded; no transaction signed");
    const nonce = await chain.getTransactionCount({
      address: owner.address,
      blockTag: "pending",
    });
    const raw = await wallet.signTransaction({
      ...request,
      chainId: sepolia.id,
      nonce,
      gas,
      ...fees,
      type: "eip1559",
    });
    step = report.steps[label] = {
      hash: keccak256(raw),
      raw,
      nonce,
      maxFee: String(gas * fees.maxFeePerGas),
    };
    save(); // Durable exact hash before any broadcast; reruns submit only these same bytes.
  }
  let receipt;
  try {
    receipt = await chain.getTransactionReceipt({ hash: step.hash });
  } catch {
    /* Not mined yet. */
  }
  if (!receipt) {
    console.log(`Submitting ${label}: ${step.hash}`);
    try {
      await wallet.sendRawTransaction({ serializedTransaction: step.raw });
    } catch (error) {
      if (!/already known|nonce too low/i.test(String(error))) throw error;
    }
  }
  receipt = await chain.waitForTransactionReceipt({
    hash: step.hash,
    confirmations: 2,
    timeout: 180000,
  });
  if (receipt.status !== "success")
    throw new Error(`${label} reverted; do not repeat with a new nonce`);
  step.gasUsed = String(receipt.gasUsed);
  step.actualFee = String(receipt.gasUsed * receipt.effectiveGasPrice);
  step.blockNumber = String(receipt.blockNumber);
  save();
  console.log(
    `Confirmed ${label}; gas ${step.gasUsed}; Sepolia ETH fee ${step.actualFee} wei`,
  );
  return receipt;
}

const receipt = await send("factory", {
  data: encodeDeployData({
    abi: forwarderFactory.abi,
    bytecode: forwarderFactory.bytecode,
  }),
});
report.factory =
  receipt.contractAddress ??
  getContractAddress({
    from: owner.address,
    nonce: BigInt(report.steps.factory.nonce),
  });
const code = await chain.getCode({ address: report.factory });
if (!code || keccak256(code) !== keccak256(forwarderFactory.deployedBytecode))
  throw new Error("Factory code mismatch");
pass("Deployed factory exactly matches the pinned contract");
console.log(`Verified Sepolia factory: ${report.factory}`);
if (!process.argv.includes("--deploy-only")) {
  const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, {
    logger: false,
  });
  const challenge = await client.mutation(api.auth.generateNonce, {
    walletAddress: owner.address,
  });
  const signature = await owner.signMessage({ message: challenge.message });
  const { token: sessionToken } = await client.mutation(
    api.auth.verifySignature,
    { walletAddress: owner.address, message: challenge.message, signature },
  );
  const scope = { orgId: workspace.orgId, sessionToken };
  const accounts = await client.query(api.safes.getForOrg, scope);
  const safe = accounts.find(
    (s) =>
      s.chainId === sepolia.id &&
      s.safeAddress.toLowerCase() === baseline.safe.toLowerCase(),
  );
  if (!safe) throw new Error("Isolated QA Safe must already be linked");
  const owners = await chain.readContract({
    address: baseline.safe,
    abi: parseAbi(["function getOwners() view returns (address[])"]),
    functionName: "getOwners",
  });
  if (!owners.some((a) => a.toLowerCase() === owner.address.toLowerCase()))
    throw new Error("QA owner mismatch");
  if (!report.invoiceId) {
    const rows = await client.query(api.receivables.list, scope);
    const existing = rows.items.find((i) => i.number === "AR-QA-20260906");
    report.invoiceId =
      existing?._id ??
      (await client.mutation(api.receivables.create, {
        ...scope,
        safeId: safe._id,
        number: "AR-QA-20260906",
        customerName: "Sepolia QA customer",
        customerEmail: "qa@example.invalid",
        description: "Isolated test invoice. Test funds only.",
        token: "USDC",
        dueDate: Date.now() + 86400000,
        items: [
          {
            description: "Receivables acceptance",
            quantity: 1,
            unitPrice: "0.010001",
          },
        ],
      }));
    save();
  }
  const args = { invoiceId: report.invoiceId, sessionToken };
  const shareToken = await client.action(api.receivableActions.issue, args);
  let invoice = await client.query(api.receivables.get, args);
  if (
    invoice.amount !== "0.010001" ||
    invoice.chainId !== sepolia.id ||
    invoice.treasury.toLowerCase() !== baseline.safe.toLowerCase() ||
    invoice.factory !== report.factory.toLowerCase()
  )
    throw new Error("Issued instructions differ from QA intent");
  report.receivingAddress = invoice.receivingAddress;
  report.publicPath = `/pay/${shareToken}`;
  save();
  pass("Backend issues verified immutable instructions for a unique address");
  const token = CHAIN_TOKENS[sepolia.id].USDC.address;
  if (!report.safeBalanceBefore) {
    report.safeBalanceBefore = String(
      await chain.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [baseline.safe],
      }),
    );
    save();
  }
  if (
    !report.steps.payment &&
    (await chain.getCode({ address: invoice.receivingAddress }))
  )
    throw new Error("Expected undeployed invoice address before first payment");
  await send("payment", {
    to: token,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [invoice.receivingAddress, 10001n],
    }),
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    await client.action(api.receivableActions.refresh, args);
    invoice = await client.query(api.receivables.get, args);
    if (invoice.received === "10001") break;
    if (invoice.syncError) console.log(invoice.syncError);
    await new Promise((resolve) => setTimeout(resolve, 12000));
  }
  if (invoice.received !== "10001")
    throw new Error("Confirmed payment has not reconciled");
  pass("Exact USDC payment tracked before funds are forwarded");
  if (!report.steps.collection) {
    const call = { ...sweepCall(invoice), chainId: invoice.chainId };
    if (
      call.chainId !== sepolia.id ||
      call.to.toLowerCase() !== report.factory.toLowerCase()
    )
      throw new Error("Unexpected forwarding call");
    await send("collection", { to: call.to, data: call.data });
  } else await send("collection", {});
  for (let attempt = 0; attempt < 5; attempt++) {
    await client.action(api.receivableActions.refresh, args);
    invoice = await client.query(api.receivables.get, args);
    if (invoice.forwarded === "10001") break;
    await new Promise((resolve) => setTimeout(resolve, 12000));
  }
  if (invoice.forwarded !== "10001")
    throw new Error("Forwarding has not reconciled");
  const safeBalanceAfter = await chain.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [baseline.safe],
  });
  if (safeBalanceAfter - BigInt(report.safeBalanceBefore) !== 10001n)
    throw new Error("Safe balance delta is not the exact invoice principal");
  pass(
    "First collection deploys the address and forwards full principal to the Safe",
  );
  await client.action(api.receivableActions.refresh, args);
  const repeated = await client.query(api.receivables.get, args);
  if (repeated.received !== "10001" || repeated.forwarded !== "10001")
    throw new Error("Duplicate scan changed accounting");
  pass("Repeated refresh preserves exact received and collected amounts");
  const publicInvoice = await client.query(api.receivables.publicInvoice, {
    token: shareToken,
  });
  if (
    publicInvoice.status !== "Paid" ||
    publicInvoice.amounts.remaining !== "0" ||
    "customerEmail" in publicInvoice
  )
    throw new Error("Public invoice projection failed");
  pass(
    "Public customer invoice is paid and omits private customer contact data",
  );
  console.log(
    JSON.stringify({
      factory: report.factory,
      receivingAddress: report.receivingAddress,
      publicPath: report.publicPath,
      received: repeated.received,
      forwarded: repeated.forwarded,
      checks: report.checks.length,
    }),
  );
}
