// Real built-app Base Sepolia delegation. Injected EIP-1193 test wallet,
// live backend, published contracts, host-held QA key, exact request allowlist.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { createPublicClient, http, hashTypedData, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { api } from "../convex/_generated/api.js";
import { nestedSigningData } from "../shared/safeSignatures.ts";
import {
  circleRootSigningData,
  decodeCircleRequest,
} from "../shared/circleRequest.ts";
import { circleConfiguration } from "../shared/circleExecution.ts";
import { openQaWallet } from "./lib/qaBrowserWallet.mjs";
assert.equal(
  process.env.VITE_CONVEX_URL,
  "https://fortunate-cat-122.convex.cloud",
);
const file = ".local/qa/circle-delegated/assigned-payer-1.json",
  saved = JSON.parse(readFileSync(file)),
  task = saved.tasks["batch-1"];
assert(
  task && !task.postAttempted,
  "Check the original browser payment. Never replay this task.",
);
const baseURL = "http://127.0.0.1:4183";
assert.equal((await fetch(baseURL)).status, 200);
const account = privateKeyToAccount(
  JSON.parse(readFileSync(".local/qa/recipients.json"))[1],
);
assert.equal(saved.delegate, account.address);
const chain = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com", {
    retryCount: 0,
    timeout: 20000,
  }),
});
assert.equal(await chain.getChainId(), 84532);
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, {
  logger: false,
});
const save = () =>
  writeFileSync(
    file,
    JSON.stringify(saved, (_, v) => (typeof v === "bigint" ? String(v) : v), 2),
    { mode: 0o600 },
  );
const sessions = [];
let token, page;
const browser = await chromium.launch();
const identity = () => ({ ...task.source, sessionToken: token });
async function typedApproval(typed) {
  const current = await client.query(api.circlePayments.get, identity()),
    request = decodeCircleRequest(current.record);
  assert(["fee", "operation"].includes(current.stage));
  assert.equal(request.originalHash, task.originalHash);
  assert.deepEqual(request.transaction, task.transaction);
  assert.equal(request.safe.toLowerCase(), saved.feeAddress);
  assert.equal(request.permit.amount, task.cap);
  assert.equal(
    hashTypedData(typed),
    nestedSigningData(
      84532,
      [saved.feeAddress],
      circleRootSigningData(request, current.stage),
    ).hash,
  );
  if (!task.browserDeclined) {
    task.browserDeclined = true;
    save();
    return {
      error: {
        code: 4001,
        message:
          "User declined transaction signature. Request Arguments: 0x1234 Version: viem@2",
      },
    };
  }
  if (current.stage === "operation")
    assert(
      current.operationApprovalStartedAt,
      "Signing must be journaled before opening the wallet.",
    );
  task.browserSignatures = (task.browserSignatures ?? 0) + 1;
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
    baseURL,
    signTypedData: typedApproval,
    signRawMessage: async () => {
      throw new Error("This story must not sign reusable allowance transfers.");
    },
    sendTransaction: async () => {
      throw new Error("Native-gas transactions are forbidden in this story.");
    },
    onSession: (value) => {
      token = value;
      sessions.push(value);
    },
  });
  await page.goto(
    `${baseURL}/org/${saved.orgId}/disbursements?focus=${task.source.delegatedDisbursementId}`,
  );
  await expect(
    page.getByRole("dialog", { name: "Payment details" }),
  ).toBeVisible();
  return page.getByRole("region", { name: "Execution fees" });
}
try {
  let fees = await open();
  await fees.getByRole("checkbox").check();
  await fees
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await expect(fees.getByRole("status")).toContainText(
    "Wallet confirmation cancelled",
  );
  await expect(fees.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Request Arguments");
  await page.screenshot({ path: ".local/review/delegated-live-declined.png" });
  await page.context().close();
  fees = await open();
  await fees.getByRole("checkbox").check();
  await fees
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Approve execution", exact: true })
    .click();
  await expect(
    fees.getByRole("button", { name: "Send payment", exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  const e = await client.query(api.circlePayments.get, identity());
  assert.equal(e.stage, "ready");
  task.signed = true;
  task.before = {};
  for (const address of [
    account.address,
    "0x01585228489577cdCdbd5eBb822C7c439a2c564c",
    saved.feeAddress,
    "0x1d724C69fEB3C75Ed33511E3a09aF5b4D0377aB5",
  ]) {
    assert.equal(await chain.getBalance({ address }), 0n);
    task.before[address.toLowerCase()] = {
      eth: "0",
      usdc: String(
        await chain.readContract({
          address: circleConfiguration(84532).token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
      ),
    };
  }
  task.before.mainNonce = "7";
  task.postAttempted = Date.now();
  save();
  await fees.getByRole("button", { name: "Send payment", exact: true }).click();
  await expect(
    fees.getByRole("button", { name: "Check execution status" }),
  ).toBeEnabled({ timeout: 60000 });
  await page.context().close();
  console.log(
    "PASS real wallet decline, reload, two account approvals, USDC-fee submission and browser-close recovery",
  );
} catch (error) {
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: ".local/review/delegated-live-browser-failure.png" })
      .catch(() => {});
    writeFileSync(
      ".local/review/delegated-live-browser-failure.txt",
      await page
        .locator("body")
        .innerText()
        .catch(() => "Page unavailable"),
    );
  }
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  for (const sessionToken of sessions)
    await client.mutation(api.auth.signOut, { sessionToken }).catch(() => {});
}
