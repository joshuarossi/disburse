// Authorized testnets only. No native-gas transaction and no operator service key.
// Every signature and the single submission attempt are journaled first.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { chromium, expect } from "@playwright/test";
import { createPublicClient, http, erc20Abi, hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import { api } from "../convex/_generated/api.js";
import {
  cctpConfiguration,
  cctpQuoteHash,
  decodeCctpQuote,
  assertCctpBurn,
  assertCctpDelivery,
} from "../shared/cctp.ts";
import {
  circleRootSigningData,
  decodeCircleRequest,
} from "../shared/circleRequest.ts";
import { nestedSigningData } from "../shared/safeSignatures.ts";
import { readCircleSettlement } from "../shared/circleSettlement.ts";
import { openQaWallet } from "./lib/qaBrowserWallet.mjs";
import { userErrorMessage } from "../src/lib/userErrors.ts";

const option = (key) =>
  process.argv
    .find((arg) => arg.startsWith(`--${key}=`))
    ?.slice(key.length + 3);
const phase = option("phase"),
  run = option("run");
assert(run && /^[a-z0-9-]{1,40}$/.test(run));
assert(["prepare", "fee", "browser", "status", "inspect"].includes(phase));
assert(
  process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") &&
    process.env.VITE_CONVEX_URL === "https://fortunate-cat-122.convex.cloud",
);
const directory = ".local/qa/circle-treasury",
  file = `${directory}/${run}.json`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
let saved = existsSync(file) ? JSON.parse(readFileSync(file)) : null;
const save = () =>
  writeFileSync(
    file,
    JSON.stringify(
      saved,
      (_, value) => (typeof value === "bigint" ? String(value) : value),
      2,
    ),
    { mode: 0o600 },
  );
const account = privateKeyToAccount(
  JSON.parse(readFileSync(".local/qa/wallet.json")).privateKey,
);
assert.equal(
  account.address.toLowerCase(),
  "0x01585228489577cdcdbd5ebb822c7c439a2c564c",
);
const sourceAddress = "0x1d724C69fEB3C75Ed33511E3a09aF5b4D0377aB5",
  destinationAddress = "0x17Fc8c99f7e823eB73b5325a0A7699f7e9c729c7";
const chain = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com", {
    retryCount: 0,
    timeout: 20000,
  }),
});
const receivingChain = createPublicClient({
  chain: sepolia,
  transport: http("https://ethereum-sepolia-rpc.publicnode.com", {
    retryCount: 0,
    timeout: 20000,
  }),
});
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, {
  logger: false,
});
const { message } = await client.mutation(api.auth.generateNonce, {
  walletAddress: account.address,
});
let token = (
  await client.mutation(api.auth.verifySignature, {
    walletAddress: account.address,
    message,
    signature: await account.signMessage({ message }),
  })
).token;
const sessions = [token],
  identity = () => ({
    treasuryTransferId: saved.transferId,
    sessionToken: token,
  });
let browser, page;
async function balances() {
  assert.equal(await chain.getBalance({ address: account.address }), 0n);
  assert.equal(await chain.getBalance({ address: sourceAddress }), 0n);
  return {
    source: String(
      await chain.readContract({
        address: cctpConfiguration(84532).token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [sourceAddress],
      }),
    ),
    destination: String(
      await receivingChain.readContract({
        address: cctpConfiguration(11155111).token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [destinationAddress],
      }),
    ),
  };
}
async function signTypedData(typed) {
  const execution = await client.query(api.circlePayments.get, identity()),
    request = decodeCircleRequest(execution.record);
  assert(["fee", "operation"].includes(execution.stage));
  assert.equal(request.originalHash, saved.hash);
  assert.equal(request.safe.toLowerCase(), sourceAddress.toLowerCase());
  assert(
    BigInt(request.permit.amount) <= 2000000n,
    "Execution fee exceeds QA budget.",
  );
  assert.equal(
    hashTypedData(typed),
    nestedSigningData(
      84532,
      [sourceAddress],
      circleRootSigningData(request, execution.stage),
    ).hash,
  );
  if (!saved.declined) {
    saved.declined = true;
    save();
    return {
      error: {
        code: 4001,
        message:
          "User rejected the request. Request Arguments: 0x1234 Version: viem@2",
      },
    };
  }
  if (execution.stage === "operation")
    assert(execution.operationApprovalStartedAt);
  saved.signingStage = execution.stage;
  saved.signatures = (saved.signatures ?? 0) + 1;
  save();
  return { value: await account.signTypedData(typed) };
}
async function open() {
  page = await openQaWallet({
    browser,
    account,
    chain,
    orgId: saved.orgId,
    theme: "light",
    baseURL: "http://127.0.0.1:4183",
    signTypedData,
    signRawMessage: async () => {
      throw new Error("Raw reusable signatures are forbidden in this story.");
    },
    sendTransaction: async () => {
      throw new Error("Native-gas transactions are forbidden in this story.");
    },
    onSession: (value) => {
      token = value;
      sessions.push(value);
    },
  });
  await page.goto(`http://127.0.0.1:4183/org/${saved.orgId}/treasury`);
  await page
    .getByRole("region", { name: "Transfers between accounts" })
    .locator(`[data-transfer-id="${saved.transferId}"]`)
    .click();
  const dialog = page.getByRole("dialog");
  if (phase === "browser")
    await dialog.getByLabel(/I have reviewed the receiving account/).check();
  return dialog.getByRole("region", { name: "Execution fees" });
}
try {
  assert.equal(await chain.getChainId(), 84532);
  assert.equal(await receivingChain.getChainId(), 11155111);
  if (phase === "prepare") {
    assert(
      !saved,
      "Use the saved transfer; never create a replacement implicitly.",
    );
    saved = {
      orgId: "k577qw9cwhtdke12n2wqy8ajgh8e1492",
      safeId: "js7dk9asem2a6c0qqt62kaczx18e1waz",
      requestId: randomUUID(),
      preparing: true,
    };
    save();
    saved.before = await balances();
    save();
    const accounts = await client.query(api.safes.getForOrg, {
      orgId: saved.orgId,
      sessionToken: token,
    });
    saved.destinationSafeId =
      accounts.find(
        (row) =>
          row.chainId === 11155111 &&
          row.safeAddress.toLowerCase() === destinationAddress.toLowerCase(),
      )?._id ??
      (
        await client.action(api.safes.link, {
          orgId: saved.orgId,
          sessionToken: token,
          safeAddress: destinationAddress,
          chainId: 11155111,
          name: "QA receiving account",
        })
      ).safeId;
    save();
    saved.transferId = await client.action(api.treasuryActions.prepare, {
      orgId: saved.orgId,
      safeId: saved.safeId,
      destinationSafeId: saved.destinationSafeId,
      requestId: saved.requestId,
      amount: "1000000",
      sessionToken: token,
    });
    save();
    const transfer = await client.query(api.treasury.get, identity()),
      quote = decodeCctpQuote(transfer.quote);
    assert(
      BigInt(quote.total) <= 5000000n,
      "Delivery exceeds this test budget.",
    );
    assert.equal(
      quote.destination.toLowerCase(),
      destinationAddress.toLowerCase(),
    );
    saved.hash = cctpQuoteHash(quote);
    saved.quote = quote;
    save();
    saved.executionId = await client.action(
      api.circlePayments.prepare,
      identity(),
    );
    save();
    console.log(
      JSON.stringify({
        prepared: saved.transferId,
        executionId: saved.executionId,
        maximumTransferUSDC: quote.total,
      }),
    );
  }
  if (phase === "fee") {
    assert(saved?.transferId && !saved.postAttempted);
    const current = await client.query(api.circlePayments.get, identity());
    saved.executionId =
      current?._id ??
      (await client.action(api.circlePayments.prepare, identity()));
    save();
    console.log(JSON.stringify({ executionId: saved.executionId }));
  }
  if (phase === "browser") {
    assert(
      saved?.executionId && !saved.postAttempted,
      "Do not replay an attempted submission.",
    );
    assert.equal((await fetch("http://127.0.0.1:4183/login")).status, 200);
    browser = await chromium.launch();
    let fees = await open();
    if (!saved.declined) {
      await fees.getByRole("checkbox").check();
      await fees
        .getByRole("button", { name: "Approve fee limit", exact: true })
        .click();
      await expect(fees.getByRole("status")).toContainText(
        "Wallet confirmation cancelled",
      );
      await expect(fees.getByRole("alert")).toHaveCount(0);
      await page.screenshot({ path: ".local/review/cctp-live-declined.png" });
      await page.context().close();
      fees = await open();
    }
    await fees.getByRole("checkbox").check();
    await fees
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await fees
      .getByRole("button", { name: "Approve execution", exact: true })
      .click();
    await expect(
      fees.getByRole("button", { name: "Start transfer", exact: true }),
    ).toBeEnabled({ timeout: 60000 });
    const execution = await client.query(api.circlePayments.get, identity());
    assert.equal(execution.stage, "ready");
    saved.record = execution.record;
    saved.before = await balances();
    saved.postAttempted = Date.now();
    save();
    await fees
      .getByRole("button", { name: "Start transfer", exact: true })
      .click();
    await expect(
      fees.getByRole("button", { name: "Check execution status" }),
    ).toBeEnabled({ timeout: 60000 });
    await page.screenshot({ path: ".local/review/cctp-live-submitted.png" });
    await page.context().close();
    console.log(
      "PASS built-app decline, reload, approvals, one USDC-funded transfer submission and browser-close recovery.",
    );
  }
  if (phase === "inspect") {
    assert(
      saved.proof,
      "Verify both original receipts before visual acceptance.",
    );
    browser = await chromium.launch();
    const fees = await open();
    const dialog = page.getByRole("dialog");
    await expect(
      fees.getByText("Actual fee charged", { exact: true }),
    ).toBeVisible();
    await expect(
      fees.getByRole("status").filter({ hasText: "Loading saved" }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("link", { name: "Receiving receipt", exact: true }),
    ).toHaveAttribute("href", new RegExp(saved.proof.destinationTxHash));
    await expect(
      dialog.getByRole("button", { name: "Start transfer", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("link", { name: "Receiving receipt", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/review/cctp-${run}-completed.png` });
    console.log(
      "PASS built-app completed transfer and both receipt links; no additional approval or submission.",
    );
  }
  if (phase === "status") {
    assert(saved?.transferId);
    await client.mutation(api.treasury.queue, identity());
    const transfer = await client.query(api.treasury.get, identity()),
      execution = await client.query(api.circlePayments.get, identity());
    console.log(
      JSON.stringify({
        transferId: transfer._id,
        status: transfer.status,
        execution: execution?.stage,
        source: transfer.sourceTxHash,
        destination: transfer.destinationTxHash,
        executionFee: execution?.fee,
        deliveryFee: transfer.deliveryFee,
        received: transfer.deliveredAmount,
        error: transfer.error,
      }),
    );
    if (transfer.sourceTxHash) {
      const sourceReceipt = await chain.getTransactionReceipt({
        hash: transfer.sourceTxHash,
      });
      const result = readCircleSettlement(
        84532,
        decodeCircleRequest(execution.record).operation,
        sourceReceipt,
      );
      assert.equal(result.status, "confirmed");
      assertCctpBurn(saved.quote, sourceReceipt.logs, result);
    }
    if (transfer.status === "completed") {
      const destinationReceipt = await receivingChain.getTransactionReceipt({
        hash: transfer.destinationTxHash,
      });
      const proof = assertCctpDelivery(saved.quote, destinationReceipt.logs);
      assert.equal(proof.amount, transfer.deliveredAmount);
      assert.equal(proof.fee, transfer.deliveryFee);
      const after = await balances();
      const sourceReceipt = await chain.getTransactionReceipt({
        hash: transfer.sourceTxHash,
      });
      async function delta(rpc, network, address, blockNumber) {
        const [before, after] = await Promise.all(
          [blockNumber - 1n, blockNumber].map((blockNumber) =>
            rpc.readContract({
              address: cctpConfiguration(network).token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
              blockNumber,
            }),
          ),
        );
        return after - before;
      }
      assert.equal(
        -(await delta(chain, 84532, sourceAddress, sourceReceipt.blockNumber)),
        BigInt(saved.quote.total) + BigInt(execution.fee),
      );
      assert.equal(
        await delta(
          receivingChain,
          11155111,
          destinationAddress,
          destinationReceipt.blockNumber,
        ),
        BigInt(transfer.deliveredAmount),
      );
      saved.proof = {
        sourceTxHash: transfer.sourceTxHash,
        destinationTxHash: transfer.destinationTxHash,
        amount: proof.amount,
        deliveryFee: proof.fee,
        executionFee: execution.fee,
        after,
      };
      save();
      console.log(
        "PASS canonical burn, delivery and exact USDC balance changes. Check the journal's delivery method before claiming provider forwarding acceptance.",
      );
    }
  }
} catch (error) {
  writeFileSync(
    ".local/review/cctp-live-error.txt",
    String(error.stack ?? error),
    { mode: 0o600 },
  );
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: ".local/review/cctp-live-failure.png" })
      .catch(() => {});
    writeFileSync(
      ".local/review/cctp-live-failure.txt",
      await page
        .locator("body")
        .innerText()
        .catch(() => "Page unavailable"),
    );
  }
  console.error(
    userErrorMessage(
      error,
      "Test transfer could not complete. Check its original journal.",
    ),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const sessionToken of sessions)
    await client.mutation(api.auth.logout, { token: sessionToken }).catch(() => {});
}
