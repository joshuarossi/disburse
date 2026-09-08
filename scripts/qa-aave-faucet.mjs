// Test fixture setup only: mint Aave's published mock USDC into our test Safe.
// Circle USDC pays the transaction fee. This script never sends native gas.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  http,
  erc20Abi,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  prepareCircleRequest,
  finishCircleFeeApproval,
} from "../convex/lib/circleAccountService.ts";
import { readAccountAuthority } from "../convex/lib/accountAuthority.ts";
import {
  circleConfiguration,
  circleOperationHash,
  circleSignature,
} from "../shared/circleExecution.ts";
import {
  circleRootSigningData,
  decodeCircleRequest,
  encodeCircleRequest,
} from "../shared/circleRequest.ts";
import { circleRpc } from "../shared/circleTransport.ts";
import { readCircleSettlement } from "../shared/circleSettlement.ts";
import { stableAccountBatch } from "../shared/stableAccountBatch.ts";
import { lendingMarket } from "../shared/lending.ts";

assert(
  process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") &&
    process.env.VITE_CONVEX_URL === "https://fortunate-cat-122.convex.cloud",
);
const phase = process.argv.find((a) => a.startsWith("--phase="))?.slice(8);
assert(["mint", "resume", "status"].includes(phase));
const directory = ".local/qa/lending",
  file = `${directory}/aave-faucet-2.json`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
let journal = existsSync(file) ? JSON.parse(readFileSync(file)) : null;
const save = () =>
  writeFileSync(
    file,
    JSON.stringify(
      journal,
      (_, v) => (typeof v === "bigint" ? String(v) : v),
      2,
    ),
    { mode: 0o600 },
  );
const wallet = privateKeyToAccount(
  JSON.parse(readFileSync(".local/qa/wallet.json")).privateKey,
);
const safe = "0x1d724C69fEB3C75Ed33511E3a09aF5b4D0377aB5",
  chainId = 84532;
assert.equal(
  wallet.address.toLowerCase(),
  "0x01585228489577cdcdbd5ebb822c7c439a2c564c",
);
const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com", {
    retryCount: 0,
    timeout: 20000,
  }),
});
const market = lendingMarket(chainId),
  config = circleConfiguration(chainId);
// Aave interface's Base Sepolia faucet. It owns the test token's mint role.
const faucet = "0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc";
const faucetAbi = parseAbi([
  "function mint(address token,address to,uint256 amount)",
]);
assert.equal(await client.getBalance({ address: wallet.address }), 0n);
assert.equal(await client.getBalance({ address: safe }), 0n);
const balance = (token) =>
  client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [safe],
  });
try {
  if (phase === "mint" || phase === "resume") {
    if (phase === "mint")
      assert(
        !journal,
        "A faucet attempt is already saved. Check its status; do not mint again.",
      );
    else
      assert(
        journal?.record && !journal.postAttemptedAt,
        "Only an unsubmitted fixture request can resume.",
      );
    assert.equal(
      (
        await client.readContract({
          address: market.asset,
          abi: parseAbi(["function owner() view returns(address)"]),
          functionName: "owner",
        })
      ).toLowerCase(),
      faucet.toLowerCase(),
    );
    await client.simulateContract({
      account: safe,
      address: faucet,
      abi: faucetAbi,
      functionName: "mint",
      args: [market.asset, safe, 1000000n],
    });
    const transaction = stableAccountBatch(chainId, [
      {
        to: faucet,
        data: encodeFunctionData({
          abi: faucetAbi,
          functionName: "mint",
          args: [market.asset, safe, 1000000n],
        }),
      },
    ]);
    const reference = keccak256(
      toHex(`disburse-aave-test-faucet:${Date.now()}`),
    );
    const request = journal
      ? decodeCircleRequest(journal.record)
      : await prepareCircleRequest({
          chainId,
          safe,
          transaction,
          directCall: true,
          principalUSDC: 0n,
          originalHash: reference,
          nonceKey: BigInt(reference) >> 64n,
          queueFeeLimit: 2000000n,
        });
    assert.equal(request.chainId, chainId);
    assert.equal(request.safe.toLowerCase(), safe.toLowerCase());
    assert.equal(
      request.transaction.to.toLowerCase(),
      transaction.to.toLowerCase(),
    );
    assert.equal(request.transaction.data, transaction.data);
    assert.equal(request.transaction.operation, transaction.operation);
    assert(BigInt(request.permit.amount) <= 2000000n);
    const authority = await readAccountAuthority(chainId, safe);
    assert.equal(authority.nodes.length, 1);
    assert.equal(authority.nodes[0].threshold, 1);
    assert.deepEqual(
      authority.nodes[0].owners.map((a) => a.toLowerCase()),
      [wallet.address.toLowerCase()],
    );
    journal ??= {
      chainId,
      safe,
      token: market.asset,
      amount: "1000000",
      feeBefore: String(await balance(config.token)),
      assetBefore: String(await balance(market.asset)),
      record: encodeCircleRequest(request),
      signing: "fee",
      createdAt: Date.now(),
    };
    save();
    const feeSignature =
      journal.feeSignature ??
      (await wallet.sign({
        hash: keccak256(circleRootSigningData(request, "fee")),
      }));
    journal.feeSignature = feeSignature;
    save();
    const complete = await finishCircleFeeApproval(request, authority, [
      {
        path: [authority.root],
        owner: wallet.address.toLowerCase(),
        signature: feeSignature,
      },
    ]);
    assert(complete);
    journal.record = encodeCircleRequest(complete);
    journal.signing = "operation";
    save();
    const signature = await wallet.sign({
      hash: keccak256(circleRootSigningData(complete, "operation")),
    });
    complete.operation.signature = circleSignature(
      complete.validAfter,
      complete.validUntil,
      signature,
    );
    journal.record = encodeCircleRequest(complete);
    journal.userOpHash = circleOperationHash(chainId, complete.operation);
    journal.postAttemptedAt = Date.now();
    save();
    const submitted = await circleRpc(chainId, "eth_sendUserOperation", [
      complete.operation,
      config.entryPoint,
    ]);
    assert.equal(submitted, journal.userOpHash);
    journal.accepted = true;
    save();
    console.log(
      JSON.stringify({
        status: "submitted",
        userOpHash: journal.userOpHash,
        amount: journal.amount,
        maximumFeeUSDC: complete.permit.amount,
      }),
    );
  } else {
    assert(journal?.postAttemptedAt);
    const response = await circleRpc(chainId, "eth_getUserOperationReceipt", [
      journal.userOpHash,
    ]);
    if (!response) {
      console.log("The original faucet operation is pending. No resubmission.");
      process.exit(0);
    }
    const hash = response.receipt?.transactionHash;
    assert(/^0x[\da-f]{64}$/i.test(hash ?? ""));
    const receipt = await client.getTransactionReceipt({ hash });
    assert((await client.getBlockNumber()) >= receipt.blockNumber + 2n);
    const settled = readCircleSettlement(
      chainId,
      decodeCircleRequest(journal.record).operation,
      receipt,
    );
    assert.equal(settled.status, "confirmed");
    const assetAfter = await balance(market.asset),
      feeAfter = await balance(config.token);
    assert.equal(assetAfter - BigInt(journal.assetBefore), 1000000n);
    assert.equal(BigInt(journal.feeBefore) - feeAfter, settled.fee);
    journal.confirmed = true;
    journal.txHash = hash;
    journal.fee = String(settled.fee);
    journal.assetAfter = String(assetAfter);
    journal.feeAfter = String(feeAfter);
    save();
    console.log(
      JSON.stringify({
        status: "confirmed",
        txHash: hash,
        mintedAaveTestUSDC: "1",
        feeUSDC: String(settled.fee),
        nativeGasBalance: "0",
      }),
    );
  }
} catch (e) {
  console.error(
    e.shortMessage ??
      (e.message?.includes("Request Arguments")
        ? "Test fixture execution failed; inspect the private journal before continuing."
        : e.message),
  );
  process.exitCode = 1;
}
