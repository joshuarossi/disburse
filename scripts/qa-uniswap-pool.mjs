// Test fixture only: seed a small Uniswap V3 pool with the test Safe's two mock assets.
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
  parseEventLogs,
  zeroAddress,
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
import {
  conversionAbi,
  conversionMarket,
  conversionPool,
} from "../shared/conversion.ts";

assert(
  process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") &&
    process.env.VITE_CONVEX_URL === "https://fortunate-cat-122.convex.cloud",
);
const phase = process.argv.find((a) => a.startsWith("--phase="))?.slice(8);
assert(["seed", "resume", "status"].includes(phase));
const run = process.argv.find((a) => a.startsWith("--run="))?.slice(6);
assert(
  ["uniswap-pool-1", "uniswap-pool-2"].includes(run),
  "Choose a named, journaled fixture run.",
);
const poolFee = run === "uniswap-pool-1" ? 100 : 3000,
  tick = poolFee === 100 ? 10 : 60;
const directory = ".local/qa/conversions",
  file = `${directory}/${run}.json`;
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
const route = conversionMarket(chainId),
  pool = conversionPool(chainId, poolFee);
const manager = "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2";
const managerAbi = parseAbi([
  "function factory() view returns(address)",
  "function createAndInitializePoolIfNecessary(address token0,address token1,uint24 fee,uint160 sqrtPriceX96) payable returns(address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable returns(uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "event IncreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
]);
const code = await client.getCode({ address: manager });
assert.equal(
  keccak256(code),
  "0x60f3e548ae28f43dfdedd281dc9233b7135dcae55050662c985583df84bc453d",
);
assert.equal(
  (
    await client.readContract({
      address: manager,
      abi: managerAbi,
      functionName: "factory",
    })
  ).toLowerCase(),
  route.factory.toLowerCase(),
);
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
  if (phase === "seed" || phase === "resume") {
    if (phase === "seed")
      assert(
        !journal,
        "A pool seed attempt is already saved. Check its status; do not seed again.",
      );
    else
      assert(
        journal?.record && !journal.postAttemptedAt,
        "Only an unsubmitted fixture request can resume.",
      );
    const existing = await client.readContract({
      address: route.factory,
      abi: conversionAbi,
      functionName: "getPool",
      args: [config.token, market.asset, poolFee],
    });
    assert(
      existing === zeroAddress ||
        (await client.readContract({
          address: pool,
          abi: conversionAbi,
          functionName: "liquidity",
        })) === 0n,
      "Use the already funded test pool; do not seed it again.",
    );
    if (run === "uniswap-pool-2") {
      assert.notEqual(
        existing,
        zeroAddress,
        "This fixture reuses an already deployed pool.",
      );
      const prior = JSON.parse(
        readFileSync(`${directory}/uniswap-pool-1.json`),
      );
      assert(
        prior.invalidatedBy,
        "Invalidate the earlier operation before funding another fixture.",
      );
    }
    const deadline = journal?.deadline ?? Math.floor(Date.now() / 1000) + 3600;
    const approve = (token, amount) => ({
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [manager, amount],
      }),
    });
    const transaction = stableAccountBatch(chainId, [
      approve(config.token, 0n),
      approve(config.token, 400000n),
      approve(market.asset, 0n),
      approve(market.asset, 400000n),
      {
        to: manager,
        data: encodeFunctionData({
          abi: managerAbi,
          functionName: "createAndInitializePoolIfNecessary",
          args: [config.token, market.asset, poolFee, 2n ** 96n],
        }),
      },
      {
        to: manager,
        data: encodeFunctionData({
          abi: managerAbi,
          functionName: "mint",
          args: [
            {
              token0: config.token,
              token1: market.asset,
              fee: poolFee,
              tickLower: -tick,
              tickUpper: tick,
              amount0Desired: 400000n,
              amount1Desired: 400000n,
              amount0Min: 399000n,
              amount1Min: 399000n,
              recipient: safe,
              deadline: BigInt(deadline),
            },
          ],
        }),
      },
      approve(config.token, 0n),
      approve(market.asset, 0n),
    ]);
    const reference = keccak256(
      toHex(`disburse-uniswap-test-pool:${Date.now()}`),
    );
    const request = journal
      ? decodeCircleRequest(journal.record)
      : await prepareCircleRequest({
          chainId,
          safe,
          transaction,
          directCall: true,
          principalUSDC: 400000n,
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
      amount: "400000",
      deadline,
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
    if (journal.invalidatedBy) {
      console.log(
        JSON.stringify({ cancelled: true, txHash: journal.invalidatedBy }),
      );
      process.exit(0);
    }
    const response = await circleRpc(chainId, "eth_getUserOperationReceipt", [
      journal.userOpHash,
    ]);
    if (!response) {
      console.log("The original pool operation is pending. No resubmission.");
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
    const events = parseEventLogs({
      abi: managerAbi,
      eventName: "IncreaseLiquidity",
      logs: receipt.logs,
      strict: true,
    }).filter((l) => l.address.toLowerCase() === manager.toLowerCase());
    assert.equal(events.length, 1);
    const event = events[0];
    const assetAfter = await balance(market.asset),
      feeAfter = await balance(config.token);
    assert.equal(BigInt(journal.assetBefore) - assetAfter, event.args.amount1);
    assert.equal(
      BigInt(journal.feeBefore) - feeAfter,
      settled.fee + event.args.amount0,
    );
    for (const token of [market.asset, config.token])
      assert.equal(
        await client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [safe, manager],
        }),
        0n,
      );
    journal.tokenId = String(event.args.tokenId);
    journal.amount0 = String(event.args.amount0);
    journal.amount1 = String(event.args.amount1);
    journal.pool = pool;
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
        pool,
        tokenId: journal.tokenId,
        amount0: journal.amount0,
        amount1: journal.amount1,
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
