// Built-app acceptance against the development backend, Base Sepolia only.
// Journal before signing/submitting; no native transaction or implicit replay.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { chromium, expect } from "@playwright/test";
import {
  createPublicClient,
  http,
  erc20Abi,
  hashTypedData,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { api } from "../convex/_generated/api.js";
import {
  lendingMarket,
  lendingQuoteHash,
  decodeLendingQuote,
  assertLendingSettlement,
} from "../shared/lending.ts";
import { circleConfiguration } from "../shared/circleExecution.ts";
import {
  circleRootSigningData,
  decodeCircleRequest,
} from "../shared/circleRequest.ts";
import { nestedSigningData } from "../shared/safeSignatures.ts";
import { readCircleSettlement } from "../shared/circleSettlement.ts";
import { openQaWallet } from "./lib/qaBrowserWallet.mjs";
import { userErrorMessage } from "../src/lib/userErrors.ts";
const option = (key) =>
  process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const phase = option("phase"),
  run = option("run"),
  kind = option("kind") ?? "supply";
assert(run && /^[a-z0-9-]{1,40}$/.test(run));
assert(["prepare", "browser", "status", "inspect"].includes(phase));
assert(["supply", "withdraw"].includes(kind));
assert(
  process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") &&
    process.env.VITE_CONVEX_URL === "https://fortunate-cat-122.convex.cloud",
);
const directory = ".local/qa/lending",
  file = `${directory}/${run}.json`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
let saved = existsSync(file) ? JSON.parse(readFileSync(file)) : null;
const save = () =>
  writeFileSync(
    file,
    JSON.stringify(saved, (_, v) => (typeof v === "bigint" ? String(v) : v), 2),
    { mode: 0o600 },
  );
const wallet = privateKeyToAccount(
  JSON.parse(readFileSync(".local/qa/wallet.json")).privateKey,
);
assert.equal(
  wallet.address.toLowerCase(),
  "0x01585228489577cdcdbd5ebb822c7c439a2c564c",
);
const safe = "0x1d724C69fEB3C75Ed33511E3a09aF5b4D0377aB5",
  chainId = 84532,
  market = lendingMarket(chainId),
  config = circleConfiguration(chainId);
const chain = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com", {
    retryCount: 0,
    timeout: 20000,
  }),
});
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, {
  logger: false,
});
const { message } = await client.mutation(api.auth.generateNonce, {
  walletAddress: wallet.address,
});
let token = (
  await client.mutation(api.auth.verifySignature, {
    walletAddress: wallet.address,
    message,
    signature: await wallet.signMessage({ message }),
  })
).token;
const sessions = [token],
  identity = () => ({
    treasuryServiceId: saved.serviceId,
    sessionToken: token,
  });
let browser, page;
async function balances() {
  assert.equal(await chain.getBalance({ address: wallet.address }), 0n);
  assert.equal(await chain.getBalance({ address: safe }), 0n);
  const [cash, position, fees] = await Promise.all(
    [market.asset, market.aToken, config.token].map((address) =>
      chain.readContract({
        address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [safe],
      }),
    ),
  );
  return { cash: String(cash), position: String(position), fees: String(fees) };
}
async function signTypedData(typed) {
  const execution = await client.query(api.circlePayments.get, identity()),
    request = decodeCircleRequest(execution.record);
  assert(["fee", "operation"].includes(execution.stage));
  assert.equal(request.originalHash, saved.hash);
  assert.equal(request.safe.toLowerCase(), safe.toLowerCase());
  assert(BigInt(request.permit.amount) <= 2000000n);
  assert.equal(
    hashTypedData(typed),
    nestedSigningData(
      chainId,
      [safe],
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
  return { value: await wallet.signTypedData(typed) };
}
async function open() {
  page = await openQaWallet({
    browser,
    account: wallet,
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
  await page.locator(`[data-service-id="${saved.serviceId}"]`).click();
  const dialog = page.getByRole("dialog");
  if (phase === "browser")
    await dialog.getByLabel(/I reviewed the company account/).check();
  return dialog.getByRole("region", { name: "Execution fees" });
}
try {
  assert.equal(await chain.getChainId(), chainId);
  if (phase === "prepare") {
    assert(!saved, "Use the saved request; do not create another implicitly.");
    saved = {
      orgId: "k577qw9cwhtdke12n2wqy8ajgh8e1492",
      safeId: "js7dk9asem2a6c0qqt62kaczx18e1waz",
      requestId: randomUUID(),
      kind,
    };
    save();
    saved.before = await balances();
    save();
    saved.serviceId = await client.action(api.treasuryServiceActions.prepare, {
      orgId: saved.orgId,
      safeId: saved.safeId,
      requestId: saved.requestId,
      kind: saved.kind,
      amount: "100000",
      withdrawAll: saved.kind === "withdraw" ? true : undefined,
      sessionToken: token,
    });
    save();
    const service = await client.query(api.treasuryServices.get, identity()),
      quote = decodeLendingQuote(service.quote);
    assert.equal(quote.chainId, chainId);
    assert.equal(quote.kind, kind);
    assert(BigInt(quote.amount) <= 100001n);
    assert.equal(!!quote.withdrawAll, kind === "withdraw");
    assert.equal(quote.account.toLowerCase(), safe.toLowerCase());
    saved.hash = lendingQuoteHash(quote);
    saved.quote = quote;
    save();
    saved.executionId = await client.action(
      api.circlePayments.prepare,
      identity(),
    );
    save();
    console.log(
      JSON.stringify({
        prepared: saved.serviceId,
        executionId: saved.executionId,
        kind,
        amount: quote.amount,
      }),
    );
  }
  if (phase === "browser") {
    assert(
      saved?.executionId && !saved.postAttempted,
      "Do not replay an attempted submission.",
    );
    assert.equal((await fetch("http://127.0.0.1:4183/login")).status, 200);
    browser = await chromium.launch();
    let execution = await open();
    if (!saved.declined) {
      await execution.getByRole("checkbox").check();
      await execution
        .getByRole("button", { name: "Approve fee limit", exact: true })
        .click();
      await expect(execution.getByRole("status")).toContainText(
        "Wallet confirmation cancelled",
      );
      await expect(execution.getByRole("alert")).toHaveCount(0);
      await page.screenshot({
        path: `.local/review/lending-${run}-declined.png`,
      });
      await page.context().close();
      execution = await open();
    }
    await execution.getByRole("checkbox").check();
    await execution
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await execution
      .getByRole("button", { name: "Approve execution", exact: true })
      .click();
    const label =
      saved.kind === "supply" ? "Deposit with Aave" : "Withdraw to account";
    await expect(
      execution.getByRole("button", { name: label, exact: true }),
    ).toBeEnabled({ timeout: 60000 });
    const current = await client.query(api.circlePayments.get, identity());
    assert.equal(current.stage, "ready");
    saved.record = current.record;
    saved.before = await balances();
    saved.postAttempted = Date.now();
    save();
    await execution.getByRole("button", { name: label, exact: true }).click();
    await expect(
      execution.getByRole("button", { name: "Check execution status" }),
    ).toBeEnabled({ timeout: 60000 });
    await page.screenshot({
      path: `.local/review/lending-${run}-submitted.png`,
    });
    await page.context().close();
    console.log(
      "PASS built-app decline, resumed approvals and one USDC-funded operation submission.",
    );
  }
  if (phase === "status") {
    assert(saved?.serviceId);
    let execution = await client.query(api.circlePayments.get, identity());
    if (execution?.open)
      await client.action(api.circlePayments.recheck, {
        executionId: execution._id,
        sessionToken: token,
      });
    const service = await client.query(api.treasuryServices.get, identity());
    execution = await client.query(api.circlePayments.get, identity());
    console.log(
      JSON.stringify({
        serviceId: saved.serviceId,
        status: service.status,
        execution: execution?.stage,
        txHash: service.sourceTxHash,
        fee: execution?.fee,
        error: execution?.error,
      }),
    );
    if (service.status === "completed") {
      const receipt = await chain.getTransactionReceipt({
        hash: service.sourceTxHash,
      });
      assert((await chain.getBlockNumber()) >= receipt.blockNumber + 2n);
      const settlement = readCircleSettlement(
        chainId,
        decodeCircleRequest(execution.record).operation,
        receipt,
      );
      assert.equal(settlement.status, "confirmed");
      assertLendingSettlement(saved.quote, receipt.logs, settlement);
      const delta = async (token) => {
        const [before, after] = await Promise.all(
          [receipt.blockNumber - 1n, receipt.blockNumber].map((blockNumber) =>
            chain.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [safe],
              blockNumber,
            }),
          ),
        );
        return after - before;
      };
      assert.equal(
        await delta(market.asset),
        BigInt(service.settledAmount ?? saved.quote.amount) *
          (saved.kind === "supply" ? -1n : 1n),
      );
      assert.equal(await delta(config.token), -BigInt(execution.fee));
      const allowance = await chain.readContract({
        address: market.asset,
        abi: erc20Abi,
        functionName: "allowance",
        args: [safe, market.pool],
        blockNumber: receipt.blockNumber,
      });
      assert.equal(allowance, 0n);
      const userData = await chain.readContract({
        address: market.dataProvider,
        abi: parseAbi([
          "function getUserReserveData(address asset,address user) view returns(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40,bool)",
        ]),
        functionName: "getUserReserveData",
        args: [market.asset, safe],
        blockNumber: receipt.blockNumber,
      });
      assert.equal(userData[8], false);
      const after = await balances();
      if (saved.quote.withdrawAll) assert.equal(after.position, "0");
      saved.proof = {
        txHash: service.sourceTxHash,
        fee: execution.fee,
        amount: service.settledAmount ?? saved.quote.amount,
        blockNumber: String(receipt.blockNumber),
        after,
      };
      save();
      console.log(
        "PASS canonical Aave principal transfer, exact USDC fee debit, zero remaining allowance, collateral disabled and zero native balance.",
      );
    }
  }
  if (phase === "inspect") {
    assert(saved.proof);
    browser = await chromium.launch();
    const execution = await open(),
      dialog = page.getByRole("dialog");
    await expect(
      execution.getByText("Actual fee charged", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "View confirmed transaction" }),
    ).toHaveAttribute("href", new RegExp(saved.proof.txHash));
    await expect(
      dialog.getByRole("button", { name: "Deposit with Aave", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Withdraw to account", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `.local/review/lending-${run}-completed.png`,
    });
    console.log(
      "PASS built-app completed lending receipt and actual customer fee.",
    );
  }
} catch (e) {
  writeFileSync(".local/review/lending-live-error.txt", String(e.stack ?? e), {
    mode: 0o600,
  });
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: ".local/review/lending-live-failure.png" })
      .catch(() => {});
    writeFileSync(
      ".local/review/lending-live-failure.txt",
      await page
        .locator("body")
        .innerText()
        .catch(() => "Page unavailable"),
    );
  }
  console.error(
    userErrorMessage(
      e,
      "The lending test could not complete. Check its original private journal.",
    ),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const sessionToken of sessions)
    await client.mutation(api.auth.logout, { token: sessionToken }).catch(() => {});
}
