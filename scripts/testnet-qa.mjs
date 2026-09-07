/** Run with Bun. Real Sepolia only; secrets stay in ignored .local/qa. */
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  formatEther,
  formatUnits,
  encodeFunctionData,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import Safe from "@safe-global/protocol-kit";
import { CHAIN_TOKENS } from "../shared/chains.ts";

const directory = ".local/qa";
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
const walletPath = `${directory}/wallet.json`;
if (!existsSync(walletPath))
  writeFileSync(
    walletPath,
    JSON.stringify({ privateKey: generatePrivateKey() }),
    { mode: 0o600 },
  );
const { privateKey } = JSON.parse(readFileSync(walletPath, "utf8"));
const account = privateKeyToAccount(privateKey);
const rpc =
  process.env.QA_SEPOLIA_RPC_URL ||
  process.env.VITE_SEPOLIA_RPC_URL ||
  sepolia.rpcUrls.default.http[0];
const client = createPublicClient({
  chain: sepolia,
  transport: http(rpc, { timeout: 20000, retryCount: 1 }),
});
const wallet = createWalletClient({
  account,
  chain: sepolia,
  transport: http(rpc),
});
if ((await client.getChainId()) !== sepolia.id)
  throw new Error("QA refuses any network except Ethereum Sepolia");
const token = CHAIN_TOKENS[sepolia.id].USDC;
const [eth, usdc, decimals] = await Promise.all([
  client.getBalance({ address: account.address }),
  client.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  }),
  client.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "decimals",
  }),
]);
if (decimals !== 6) throw new Error("Unexpected test USDC decimals");
const reportPath = `${directory}/testnet-report.json`;
const report = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8"))
  : {
      chainId: sepolia.id,
      wallet: account.address,
      token: token.address,
      transactions: [],
    };
if (report.chainId !== sepolia.id || report.wallet !== account.address)
  throw new Error("QA report belongs to another wallet/network");
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
report.checkedAt = new Date().toISOString();
report.walletBalance = { ETH: formatEther(eth), USDC: formatUnits(usdc, 6) };
save();
console.log(
  JSON.stringify({
    network: "Ethereum Sepolia",
    wallet: account.address,
    balances: report.walletBalance,
  }),
);
if (!process.argv.includes("--execute")) process.exit(0);
if (eth < 2_000_000_000_000_000n || (!report.safe && usdc < 5_000_000n)) {
  report.status =
    "blocked: fund the isolated wallet with test ETH and Circle test USDC";
  save();
  console.log(report.status);
  process.exit(2);
}
// Save the hash immediately. If interrupted, inspect its receipt before resuming.
async function send(label, transaction) {
  const previous = report.transactions.find((t) => t.label === label);
  let hash = previous?.hash;
  if (!hash) {
    hash = await wallet.sendTransaction({
      ...transaction,
      value: BigInt(transaction.value || 0),
    });
    report.transactions.push({ label, hash, status: "submitted" });
    save();
  }
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 2,
    timeout: 180000,
  });
  const entry = report.transactions.find((t) => t.hash === hash);
  entry.status = receipt.status;
  entry.block = String(receipt.blockNumber);
  save();
  if (receipt.status !== "success")
    throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: https://sepolia.etherscan.io/tx/${hash}`);
  return receipt;
}
let sdk;
if (!report.safe) {
  const predicted = await Safe.init({
    provider: rpc,
    signer: privateKey,
    predictedSafe: {
      safeAccountConfig: { owners: [account.address], threshold: 1 },
      safeDeploymentConfig: { saltNonce: "20260905" },
    },
  });
  report.safe = await predicted.getAddress();
  save();
  report.deployTransaction = await predicted.createSafeDeploymentTransaction();
  save();
}
if (!(await client.getCode({ address: report.safe })))
  await send("Deploy QA Safe", report.deployTransaction);
sdk = await Safe.init({
  provider: rpc,
  signer: privateKey,
  safeAddress: report.safe,
});
if (
  !report.transactions.some(
    (t) => t.label === "Fund QA Safe" && t.status === "success",
  )
)
  await send("Fund QA Safe", {
    to: token.address,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [report.safe, 5_000_000n],
    }),
  });
// Separate controlled recipients; never send to existing application beneficiaries.
const recipientsPath = `${directory}/recipients.json`;
if (!existsSync(recipientsPath))
  writeFileSync(
    recipientsPath,
    JSON.stringify([generatePrivateKey(), generatePrivateKey()]),
    { mode: 0o600 },
  );
const recipients = JSON.parse(readFileSync(recipientsPath, "utf8")).map(
  privateKeyToAccount,
);
const amounts = [1_000_001n, 2_000_002n];
if (!report.batch) {
  const before = await Promise.all(
    recipients.map((r) =>
      client.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [r.address],
      }),
    ),
  );
  const transaction = await sdk.createTransaction({
    transactions: recipients.map((r, i) => ({
      to: token.address,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [r.address, amounts[i]],
      }),
      operation: 0,
    })),
  });
  const signed = await sdk.signTransaction(transaction);
  report.batch = {
    recipients: recipients.map((r, i) => ({
      address: r.address,
      amount: String(amounts[i]),
      before: String(before[i]),
    })),
    safeTxHash: await sdk.getTransactionHash(signed),
    encoded: await sdk.getEncodedTransaction(signed),
  };
  save();
}
await send("Execute exact USDC batch", {
  to: report.safe,
  data: report.batch.encoded,
});
for (const recipient of report.batch.recipients) {
  const balance = await client.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [recipient.address],
  });
  if (balance - BigInt(recipient.before) !== BigInt(recipient.amount))
    throw new Error("Recipient balance does not match the exact payment");
}
report.status =
  "passed: Safe deployment and exact USDC batch; app proposal, scheduled relay and delegation acceptance still pending";
save();
console.log(report.status);
