// Development-only, journaled acceptance: credit an existing collected test invoice
// and refund 0.01 USDC through the built app. Never replay an attempted submission.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { chromium, expect } from "@playwright/test";
import { createPublicClient, http, erc20Abi, hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { api } from "../convex/_generated/api.js";
import { circleConfiguration } from "../shared/circleExecution.ts";
import {
  circleRootSigningData,
  decodeCircleRequest,
} from "../shared/circleRequest.ts";
import {
  nestedSigningData,
  approvalSigningData,
} from "../shared/safeSignatures.ts";
import { readCircleSettlement } from "../shared/circleSettlement.ts";
import { openQaWallet } from "./lib/qaBrowserWallet.mjs";
import { userErrorMessage } from "../src/lib/userErrors.ts";
const phase = process.argv.find((a) => a.startsWith("--phase="))?.slice(8);
assert(["browser", "status", "inspect"].includes(phase));
assert(
  process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") &&
    process.env.VITE_CONVEX_URL === "https://fortunate-cat-122.convex.cloud",
);
const dir = ".local/qa/receivable-workflows",
  file = `${dir}/base-sepolia-refund-1.json`;
mkdirSync(dir, { recursive: true, mode: 0o700 });
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
  identity = () => ({ disbursementId: saved.paymentId, sessionToken: token }),
  invoiceIdentity = () => ({ invoiceId: saved.invoiceId, sessionToken: token });
let browser, page;
async function signTypedData(typed) {
  const payment = await client.query(
    api.disbursements.getWithRecipients,
    identity(),
  );
  assert.equal(payment.refundInvoiceId, saved.invoiceId);
  assert.equal(payment.totalAmount, "0.01");
  assert.equal(payment.token, "USDC");
  assert.equal(payment.chainId, chainId);
  assert.equal(payment.recipients.length, 1);
  assert.equal(
    payment.recipients[0].recipientAddress.toLowerCase(),
    wallet.address.toLowerCase(),
  );
  const execution = await client.query(api.circlePayments.get, identity());
  if (!execution) {
    const request = await client.action(
      api.accountApprovals.forSigning,
      identity(),
    );
    assert.equal(request.paths.length, 1);
    assert.deepEqual(
      request.paths[0].path.map((s) => s.toLowerCase()),
      [safe.toLowerCase()],
    );
    assert.equal(
      hashTypedData(typed),
      approvalSigningData(chainId, [safe], request.proposal.safeTransactionData)
        .hash,
    );
    saved.hash = request.proposal.safeTxHash;
    save();
  } else {
    const request = decodeCircleRequest(execution.record);
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
  }
  return { value: await wallet.signTypedData(typed) };
}
async function open(path) {
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
  await page.goto(`http://127.0.0.1:4183/org/${saved.orgId}/${path}`);
}
try {
  assert.equal(await chain.getChainId(), chainId);
  assert.equal(await chain.getBalance({ address: wallet.address }), 0n);
  assert.equal(await chain.getBalance({ address: safe }), 0n);
  if (phase === "browser") {
    if (!saved) {
      saved = {
        orgId: "k576g5ejvgxthhw9d57y9yzas18dzf8n",
        invoiceId: "mx7efa63pakqhcpbxt26gswhxs8dz107",
        safeId: "js779sqdwa1tsgf8w2j0h287sh8dzz3p",
        recipientId: "j971gtznsqa1nzfzt3hw205d3n8dyz5j",
        creditNumber: "CN-QA-REFUND-001",
      };
      save();
    }
    assert(
      !saved.postAttempted,
      "Check the saved submission; never resubmit implicitly.",
    );
    assert.equal((await fetch("http://127.0.0.1:4183/login")).status, 200);
    browser = await chromium.launch();
    const invoice = await client.query(api.receivables.get, invoiceIdentity());
    assert.equal(invoice.amount, "0.1");
    assert.equal(invoice.received, "100000");
    assert.equal(invoice.forwarded, "100000");
    await open("receivables");
    await page
      .getByRole("button", { name: invoice.number, exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
        name: `Invoice ${invoice.number}`,
      }),
      section = dialog.getByRole("region", { name: "Credits and refunds" });
    let details = await client.query(
      api.receivableWorkflows.details,
      invoiceIdentity(),
    );
    if (!details.credits.some((c) => c.number === saved.creditNumber)) {
      assert.equal(invoice.credited ?? "0", "0");
      await section
        .getByRole("button", { name: "Issue credit note", exact: true })
        .click();
      await section
        .getByLabel("Credit note number", { exact: true })
        .fill(saved.creditNumber);
      await section
        .getByLabel("Reason shown to the customer", { exact: true })
        .fill("Test invoice adjustment and customer refund acceptance");
      await section
        .getByLabel("Credit amount · USDC", { exact: true })
        .fill("0.01");
      await section.getByRole("checkbox").check();
      await section
        .getByRole("button", { name: "Issue credit", exact: true })
        .click();
      await expect(
        section.getByRole("button", {
          name: `Reconcile credit ${saved.creditNumber}`,
        }),
      ).toBeVisible();
      details = await client.query(
        api.receivableWorkflows.details,
        invoiceIdentity(),
      );
    }
    saved.creditId = details.credits.find(
      (c) => c.number === saved.creditNumber,
    )._id;
    save();
    if (!saved.paymentId) {
      assert.equal(
        details.refunds.length,
        0,
        "Inspect the existing refund before creating another.",
      );
      await section
        .getByRole("button", { name: "Prepare refund", exact: true })
        .click();
      await section
        .getByRole("combobox", { name: "Refund recipient", exact: true })
        .selectOption(saved.recipientId);
      await section
        .getByLabel("Refund amount · USDC", { exact: true })
        .fill("0.01");
      await section.getByLabel(/I confirmed this reviewed recipient/).check();
      await section
        .getByRole("button", { name: "Save refund draft", exact: true })
        .click();
      await expect(page).toHaveURL(/disbursements\?focus=/);
      saved.paymentId = new URL(page.url()).searchParams.get("focus");
      save();
    } else
      await page.goto(
        `http://127.0.0.1:4183/org/${saved.orgId}/disbursements?focus=${saved.paymentId}`,
      );
    let review = page.getByRole("dialog", { name: "Payment details" });
    const payment = await client.query(
      api.disbursements.getWithRecipients,
      identity(),
    );
    if (!payment.safeTxHash) {
      await review
        .getByRole("button", { name: "Review in wallet", exact: true })
        .click();
    } else {
      saved.hash = payment.safeTxHash;
      save();
    }
    let execution = review.getByRole("region", { name: "Execution fees" });
    const prepare = execution.getByRole("button", {
      name: "Review execution fee",
      exact: true,
    });
    if (!(await client.query(api.circlePayments.get, identity())))
      await prepare.click();
    if (!saved.declined) {
      await execution.getByRole("checkbox").check();
      await execution
        .getByRole("button", { name: "Approve fee limit", exact: true })
        .click();
      await expect(execution.getByRole("status")).toContainText(
        "Wallet confirmation cancelled",
      );
      await expect(execution.getByRole("alert")).toHaveCount(0);
      await page.screenshot({ path: ".local/review/ar-refund-declined.png" });
      await page.context().close();
      await open(`disbursements?focus=${saved.paymentId}`);
      review = page.getByRole("dialog", { name: "Payment details" });
      execution = review.getByRole("region", { name: "Execution fees" });
    }
    await execution.getByRole("checkbox").check();
    await execution
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await execution
      .getByRole("button", { name: "Approve execution", exact: true })
      .click();
    const send = execution.getByRole("button", {
      name: "Send payment",
      exact: true,
    });
    await expect(send).toBeEnabled({ timeout: 60000 });
    const current = await client.query(api.circlePayments.get, identity());
    assert.equal(current.stage, "ready");
    saved.executionId = current._id;
    saved.record = current.record;
    saved.postAttempted = Date.now();
    save();
    await send.click();
    await expect(
      execution.getByRole("button", { name: "Check execution status" }),
    ).toBeEnabled({ timeout: 60000 });
    await page.screenshot({ path: ".local/review/ar-refund-submitted.png" });
    await page.context().close();
    console.log(
      "PASS credit issued, reviewed refund drafted, cancelled approval recovered and one customer-funded submission.",
    );
  }
  if (phase === "status") {
    assert(saved?.paymentId);
    let execution = await client.query(api.circlePayments.get, identity());
    if (execution?.open)
      await client.action(api.circlePayments.recheck, {
        executionId: execution._id,
        sessionToken: token,
      });
    execution = await client.query(api.circlePayments.get, identity());
    const payment = await client.query(
      api.disbursements.getWithRecipients,
      identity(),
    );
    console.log(
      JSON.stringify({
        paymentId: saved.paymentId,
        status: payment.status,
        execution: execution?.stage,
        txHash: payment.txHash,
        fee: execution?.fee,
        error: execution?.error,
      }),
    );
    if (payment.status === "executed") {
      const receipt = await chain.getTransactionReceipt({
        hash: payment.txHash,
      });
      assert((await chain.getBlockNumber()) >= receipt.blockNumber + 2n);
      const settlement = readCircleSettlement(
        chainId,
        decodeCircleRequest(execution.record).operation,
        receipt,
      );
      assert.equal(settlement.status, "confirmed");
      for (const address of [safe, wallet.address]) {
        const [before, after] = await Promise.all(
          [receipt.blockNumber - 1n, receipt.blockNumber].map((blockNumber) =>
            chain.readContract({
              address: config.token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
              blockNumber,
            }),
          ),
        );
        assert.equal(
          after - before,
          address === safe ? -10000n - BigInt(execution.fee) : 10000n,
        );
      }
      const invoice = await client.query(
          api.receivables.get,
          invoiceIdentity(),
        ),
        details = await client.query(
          api.receivableWorkflows.details,
          invoiceIdentity(),
        );
      assert.equal(invoice.credited, "10000");
      assert.equal(invoice.refunded, "10000");
      assert.equal(invoice.received, "100000");
      assert.equal(details.availableRefund, "0");
      saved.proof = {
        txHash: payment.txHash,
        blockNumber: String(receipt.blockNumber),
        fee: execution.fee,
        refunded: invoice.refunded,
        credited: invoice.credited,
      };
      save();
      console.log(
        "PASS exact customer refund, exact customer-paid USDC fee, retained original receipt and zero native balance.",
      );
    }
  }
  if (phase === "inspect") {
    assert(saved.proof);
    browser = await chromium.launch();
    await open(`disbursements?focus=${saved.paymentId}`);
    const review = page.getByRole("dialog", { name: "Payment details" });
    await expect(review).toContainText("Actual fee charged");
    await expect(
      review.getByRole("button", { name: "Send payment", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({ path: ".local/review/ar-refund-completed.png" });
    const invoice = await client.query(api.receivables.get, invoiceIdentity());
    await page.goto(`http://127.0.0.1:4183/pay/${invoice.publicToken}`);
    await expect(
      page.getByRole("region", { name: "Credit notes" }),
    ).toContainText(saved.creditNumber);
    await expect(
      page.getByText("Refunded 0.01 USDC", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: ".local/review/ar-refund-public.png",
      fullPage: true,
    });
    console.log(
      "PASS built-app completed refund and customer credit statement.",
    );
  }
} catch (error) {
  writeFileSync(
    ".local/review/ar-live-error.txt",
    String(error.stack ?? error),
    { mode: 0o600 },
  );
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: ".local/review/ar-live-failure.png" })
      .catch(() => {});
    writeFileSync(
      ".local/review/ar-live-failure.txt",
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
      { mode: 0o600 },
    );
  }
  console.error(
    userErrorMessage(
      error,
      "The receivable test could not complete. Inspect its original private journal.",
    ),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const sessionToken of sessions)
    await client.mutation(api.auth.logout, { token: sessionToken });
}
