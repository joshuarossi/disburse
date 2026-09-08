/** Complete finance-cycle acceptance in the isolated Sepolia workspace.
 * Uses existing test wallets and synthetic books. Never targets mainnet.
 * Run prepare -> execute -> status -> export. A submitted transaction is never replayed.
 * Native Sepolia fees are explicitly separate from Circle USDC-fee acceptance.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, expect as browserExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ConvexHttpClient } from "convex/browser";
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { api } from "../convex/_generated/api.js";
import { approvalSigningData } from "../shared/safeSignatures.ts";
import { parseCsvRecords } from "../src/lib/csv.ts";
import { openQaWallet } from "./lib/qaBrowserWallet.mjs";

const expect = browserExpect.configure({ timeout: 30_000 });
const args = Object.fromEntries(
  process.argv.slice(2).map((value) => value.replace(/^--/, "").split("=")),
);
const phase = args.phase;
assert.ok(
  ["prepare", "execute", "status", "export", "inspect"].includes(phase),
  "Choose --phase=prepare|execute|status|export|inspect",
);
assert.match(args.run ?? "", /^[a-z0-9-]{8,60}$/);
assert.equal(process.env.CONVEX_DEPLOYMENT, "dev:fortunate-cat-122");
assert.equal(
  process.env.VITE_CONVEX_URL,
  "https://fortunate-cat-122.convex.cloud",
);
const orgId = "k575vpg8mtsn2126zbswdg4rfd8dvk88";
const payroll = "0x24e71B8681D5E409f37870eAbBbA301d0a9eFfa2";
const parent = "0xf4edB71c68c4cFC2EC298BfE181cc5647D6a51d2";
const safeId = "js7bcc6ptgre1eb621y0a0d3jn8dz773";
const beneficiaryId = "j975wt51te4263trsdd32ey3eh8dt8by";
const usdc = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const baseURL = "http://127.0.0.1:4180";
const owner = privateKeyToAccount(
  JSON.parse(readFileSync(".local/qa/wallet.json")).privateKey,
);
const second = privateKeyToAccount(
  JSON.parse(readFileSync(".local/qa/recipients.json"))[1],
);
assert.equal(
  owner.address.toLowerCase(),
  "0x01585228489577cdcdbd5ebb822c7c439a2c564c",
);
assert.equal(
  second.address.toLowerCase(),
  "0x84afea32f150e673e260318bcfc34ef56b99820e",
);
const dir = `.local/qa/finance-cycle/${args.run}`;
mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = `${dir}/journal.json`;
const journal = existsSync(file)
  ? JSON.parse(readFileSync(file))
  : {
      orgId,
      safeId,
      chainId: 11155111,
      amount: "0.01",
      invoiceNumber: `QA-${args.run}`,
      checks: [],
      transactions: [],
    };
assert.equal(journal.orgId, orgId);
assert.equal(journal.safeId, safeId);
assert.equal(journal.chainId, 11155111);
assert.equal(journal.amount, "0.01");
const save = () =>
  writeFileSync(file, JSON.stringify(journal, null, 2), { mode: 0o600 });
const pass = (name) => {
  if (!journal.checks.includes(name)) journal.checks.push(name);
  save();
  console.log(`PASS ${name}`);
};
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, {
  logger: false,
});
const chain = createPublicClient({
  chain: sepolia,
  transport: http(
    process.env.QA_SEPOLIA_RPC_URL ||
      "https://ethereum-sepolia-rpc.publicnode.com",
    { timeout: 20000, retryCount: 1 },
  ),
});
const wallet = createWalletClient({
  chain: sepolia,
  transport: http(
    process.env.QA_SEPOLIA_RPC_URL ||
      "https://ethereum-sepolia-rpc.publicnode.com",
  ),
  account: owner,
});
assert.equal(await chain.getChainId(), 11155111);
const sessions = [];
async function login(account) {
  const { message } = await client.mutation(api.auth.generateNonce, {
    walletAddress: account.address,
  });
  const { token } = await client.mutation(api.auth.verifySignature, {
    walletAddress: account.address,
    message,
    signature: await account.signMessage({ message }),
  });
  sessions.push(token);
  return token;
}
const token = await login(owner);
const scope = { orgId, sessionToken: token };
const identity = () => ({
  disbursementId: journal.disbursementId,
  sessionToken: token,
});
const getPayment = () =>
  client.query(api.disbursements.getWithRecipients, identity());
const getBills = () => client.query(api.invoices.list, scope);
const browser = phase === "status" ? null : await chromium.launch();
let lastPage;
async function inspect(page, name, target) {
  const root = target ?? page.locator("main");
  if (target) await target.scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) =>
          Number.isFinite(animation.effect?.getComputedTiming().endTime),
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Unexpected page overflow",
  );
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  if (result.violations.length)
    writeFileSync(
      `${dir}/accessibility-${name}.json`,
      JSON.stringify(
        result.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, html, failureSummary }) => ({
            target,
            html,
            failureSummary,
          })),
        })),
      ),
      { mode: 0o600 },
    );
  assert.deepEqual(
    result.violations.map((v) => ({ id: v.id, impact: v.impact })),
    [],
    `Accessibility failures on ${name}`,
  );
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  if (await root.count()) assert.ok((await root.innerText()).trim().length > 0);
  pass(`${name}: built screen and accessibility/overflow checks`);
}
async function open(account, theme, callbacks = {}) {
  const page = await openQaWallet({
    browser,
    account,
    chain,
    orgId,
    theme,
    baseURL,
    onSession: (value) => sessions.push(value),
    signTypedData: async () => {
      throw new Error("This phase cannot approve financial authorizations");
    },
    sendTransaction: async () => {
      throw new Error("This phase cannot send transactions");
    },
    ...callbacks,
  });
  lastPage = page;
  return page;
}
async function transaction(label, tx) {
  assert.ok(
    !journal.transactions.some((row) => row.label === label),
    "This transaction already has a journal. Use status; do not submit it again.",
  );
  const prepared = await wallet.prepareTransactionRequest({
    ...tx,
    account: owner,
  });
  assert.ok(
    prepared.gas * prepared.maxFeePerGas <= 1_000_000_000_000_000n,
    "Native test fee exceeds 0.001 ETH cap",
  );
  const raw = await owner.signTransaction(prepared);
  const record = { label, hash: keccak256(raw), raw, postAttempted: true };
  journal.transactions.push(record);
  save();
  const hash = await chain.sendRawTransaction({ serializedTransaction: raw });
  assert.equal(hash, record.hash);
  return hash;
}
async function paymentStatus() {
  assert.ok(journal.disbursementId);
  const p = await getPayment();
  assert.equal(p.safeId, safeId);
  assert.equal(p.totalAmount, "0.01");
  assert.equal(p.token, "USDC");
  if (p.status !== "executed") {
    console.log(
      JSON.stringify({
        paymentStatus: p.status,
        hasOriginalHash: !!p.txHash,
        walletRejected: !!p.nativeExecution?.walletRejectedAt,
        canResubmit: false,
      }),
    );
    return false;
  }
  const original = journal.transactions.find(
    (row) => row.label === "bill-payment",
  );
  assert.ok(original, "No locally approved transaction exists");
  assert.equal(p.txHash, original.hash);
  assert.equal(p.safeTxHash, journal.safeTxHash);
  const receipt = await chain.getTransactionReceipt({ hash: original.hash });
  assert.equal(receipt.status, "success");
  const transfers = parseEventLogs({
    abi: erc20Abi,
    logs: receipt.logs,
    eventName: "Transfer",
  }).filter(
    (log) =>
      log.address.toLowerCase() === usdc.toLowerCase() &&
      log.args.from.toLowerCase() === payroll.toLowerCase(),
  );
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].args.to.toLowerCase(), owner.address.toLowerCase());
  assert.equal(transfers[0].args.value, 10000n);
  const at = (blockNumber) =>
    chain.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner.address],
      blockNumber,
    });
  assert.equal(
    (await at(receipt.blockNumber)) - (await at(receipt.blockNumber - 1n)),
    10000n,
  );
  const bill = (await getBills()).find((row) => row._id === journal.invoiceId);
  assert.equal(bill.status, "paid");
  assert.equal(bill.disbursementId, p._id);
  journal.settled = true;
  journal.txHash = receipt.transactionHash;
  journal.settledBlock = String(receipt.blockNumber);
  save();
  pass(
    "One original transaction paid exactly 0.01 test USDC and reconciled its bill",
  );
  return true;
}
try {
  const org = await client.query(api.orgs.get, scope);
  assert.ok(org.name.includes("QA"));
  if (phase !== "status")
    assert.equal(
      (await fetch(baseURL)).status,
      200,
      "Build and run the native QA preview on port 4180",
    );
  if (phase === "prepare") {
    assert.ok(
      !journal.disbursementId,
      "Preparation already finished; use execute",
    );
    const page = await open(owner, "light");
    const before = await client.query(api.beneficiaries.list, scope);
    const recipient = before.find((row) => row._id === beneficiaryId);
    assert.ok(recipient?.isActive);
    assert.equal(recipient.payoutReviewStatus, "approved");
    assert.equal(
      recipient.walletAddress.toLowerCase(),
      owner.address.toLowerCase(),
    );
    assert.equal(recipient.preferredToken, "USDC");
    assert.equal(recipient.preferredChainId, 11155111);
    const inputFile = {
      name: "qa-gusto-export.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `Employee ID,Name,Email,Payment address,Currency,Network\nfinance-cycle-001,${recipient.name},${recipient.email},${recipient.walletAddress},USDC,Sepolia\n`,
      ),
    };
    for (let round = 0; round < 2; round++) {
      await page.goto(`${baseURL}/org/${orgId}/beneficiaries?import=1`);
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Source system for employee or vendor IDs")
        .selectOption("gusto");
      await dialog.locator("input[type=file]").setInputFiles(inputFile);
      const row = dialog.getByRole("row").filter({ hasText: recipient.name });
      const alreadyImported =
        recipient.sourceSystem === "gusto" &&
        recipient.sourceId === "finance-cycle-001";
      if (round === 0 && !journal.imported && !alreadyImported) {
        await expect(row).toContainText("Update existing");
        await inspect(page, "import-review-light", row);
        await dialog
          .getByRole("button", { name: "Apply 1 change", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", { name: "Import complete" }),
        ).toContainText("0 created");
        journal.imported = true;
        save();
        await page.getByRole("button", { name: "Done", exact: true }).click();
      } else {
        await expect(row).toContainText("Skip");
        await expect(row.getByRole("checkbox")).toBeDisabled();
        await expect(
          dialog.getByRole("button", { name: "Apply 0 changes" }),
        ).toBeDisabled();
        await inspect(page, "repeat-import-light", row);
        journal.imported = true;
        save();
      }
    }
    const after = await client.query(api.beneficiaries.list, scope);
    assert.equal(after.length, before.length);
    const saved = after.find((row) => row._id === beneficiaryId);
    assert.equal(saved.sourceId, "finance-cycle-001");
    assert.equal(saved.sourceSystem, "gusto");
    assert.equal(saved.preferredToken, "USDC");
    assert.equal(saved.walletAddress, recipient.walletAddress);
    assert.equal(saved.payoutReviewStatus, "approved");
    pass(
      "Repeated employee import preserves the approved payout and creates no duplicate recipient",
    );
    await page.goto(`${baseURL}/org/${orgId}/invoices`);
    const existing = (await getBills()).filter(
      (row) => row.invoiceNumber === journal.invoiceNumber,
    );
    assert.ok(existing.length <= 1);
    if (existing.length) journal.invoiceId = existing[0]._id;
    else {
      await page.getByRole("button", { name: "Add bill", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Add a bill" });
      await editor
        .getByRole("combobox", { name: "Vendor or contractor", exact: true })
        .selectOption(beneficiaryId);
      await expect(editor.getByLabel("Payment currency")).toHaveValue("USDC");
      await editor
        .getByLabel("Invoice number", { exact: true })
        .fill(journal.invoiceNumber);
      await editor
        .getByLabel("Due date", { exact: true })
        .fill(new Date().toISOString().slice(0, 10));
      await editor.getByLabel("Amount due", { exact: true }).fill("0.01");
      await editor
        .getByLabel("Description", { exact: true })
        .fill("Synthetic QA bill for the complete finance-cycle acceptance");
      await inspect(page, "bill-review-light", editor);
      await editor
        .getByRole("button", { name: "Add bill", exact: true })
        .click();
      await expect(editor).toHaveCount(0);
      const bills = (await getBills()).filter(
        (row) => row.invoiceNumber === journal.invoiceNumber,
      );
      assert.equal(bills.length, 1);
      journal.invoiceId = bills[0]._id;
      save();
    }
    const bill = (await getBills()).find(
      (row) => row._id === journal.invoiceId,
    );
    if (bill.disbursementId) journal.disbursementId = bill.disbursementId;
    else {
      await page
        .getByRole("checkbox", {
          name: `Select invoice ${journal.invoiceNumber}`,
          exact: true,
        })
        .check();
      await page
        .getByRole("button", { name: "Review payment", exact: true })
        .click();
      const review = page.getByRole("dialog", { name: "Review bill payment" });
      await review
        .getByRole("combobox", { name: "Pay from", exact: true })
        .selectOption(safeId);
      await expect(review).toContainText("0.01");
      await inspect(page, "bill-payment-preparation-light", review);
      await review
        .getByRole("button", { name: "Prepare payment", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Payment details" }),
      ).toBeVisible();
      journal.disbursementId = new URL(page.url()).searchParams.get("focus");
      assert.ok(journal.disbursementId);
      save();
    }
    const payment = await getPayment();
    assert.equal(payment.safeId, safeId);
    assert.equal(payment.totalAmount, "0.01");
    assert.equal(payment.status, "draft");
    pass(
      "Built-app bill preparation retains its reviewed recipient, exact amount and nested Payroll account",
    );
  }
  if (phase === "execute") {
    assert.ok(journal.disbursementId);
    assert.ok(
      !journal.transactions.some((row) => row.label === "bill-payment"),
      "Already submitted. Use status, not execute.",
    );
    const balance = await chain.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [payroll],
    });
    if (balance < 10000n) {
      const hash = await transaction("fund-payroll", {
        to: usdc,
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [payroll, 10000n - balance],
        }),
      });
      assert.equal(
        (
          await chain.waitForTransactionReceipt({
            hash,
            confirmations: 2,
            timeout: 180000,
          })
        ).status,
        "success",
      );
      pass("Existing test wallet funded only the 0.01 USDC Payroll principal");
    }
    const callbacks = (account) => ({
      signTypedData: async (typed) => {
        const current = await client.action(
          api.accountApprovals.forSigning,
          identity(),
        );
        const expected = approvalSigningData(
          11155111,
          [payroll, parent],
          current.proposal.safeTransactionData,
        );
        assert.equal(hashTypedData(typed), expected.hash);
        assert.equal(current.proposal.safeTransactionData.value, "0");
        if (account.address === owner.address && !journal.signatureDeclined) {
          journal.signatureDeclined = true;
          save();
          return {
            error: { code: 4001, message: "User rejected the request" },
          };
        }
        journal.safeTxHash = current.proposal.safeTxHash;
        save();
        return { value: await account.signTypedData(typed) };
      },
      sendTransaction: async (tx) => {
        assert.equal(account.address, owner.address);
        assert.equal(tx.from.toLowerCase(), owner.address.toLowerCase());
        assert.equal(tx.to.toLowerCase(), payroll.toLowerCase());
        assert.equal(BigInt(tx.value ?? "0"), 0n);
        const expected = await client.action(
          api.accountApprovals.execution,
          identity(),
        );
        assert.equal(tx.data, expected.data);
        if (!journal.sendDeclined) {
          journal.sendDeclined = true;
          save();
          return {
            error: { code: 4001, message: "User rejected the request" },
          };
        }
        return {
          value: await transaction("bill-payment", {
            to: expected.to,
            data: expected.data,
            value: 0n,
          }),
        };
      },
    });
    const first = await open(owner, "light", callbacks(owner));
    const url = `${baseURL}/org/${orgId}/disbursements?focus=${journal.disbursementId}`;
    await first.goto(url);
    const review = first.getByRole("dialog", { name: "Payment details" });
    if (!(await getPayment()).safeTxHash) {
      await review
        .getByRole("button", { name: "Review in wallet", exact: true })
        .click();
      await review
        .getByRole("button", {
          name: "Confirm approval in wallet",
          exact: true,
        })
        .click();
      await expect(review).toContainText(/cancelled|declined/i);
      await expect(review).not.toContainText(
        /Request Arguments|viem@|UserOperation/,
      );
      assert.equal((await getPayment()).safeTxHash, undefined);
      await inspect(first, "approval-declined-light", review);
      await first.reload();
      await review
        .getByRole("button", { name: "Review in wallet", exact: true })
        .click();
      await review
        .getByRole("button", {
          name: "Confirm approval in wallet",
          exact: true,
        })
        .click();
    }
    const other = await open(second, "dark", callbacks(second));
    await other.goto(url);
    const otherReview = other.getByRole("dialog", { name: "Payment details" });
    const current = await getPayment();
    if (current.status !== "relaying") {
      const approvals = await client.action(
        api.paymentExecution.approvalStatus,
        identity(),
      );
      if (!approvals.ready) {
        await expect(
          review.getByRole("region", {
            name: /QA Treasury approval group approvals/,
          }),
        ).toContainText("1 of 2 approvals received");
        await expect(
          review.getByRole("button", { name: "Send payment", exact: true }),
        ).toBeDisabled();
        pass(
          "Declined first approval remains readable and cannot bypass the parent threshold",
        );
        await otherReview
          .getByRole("button", { name: "Approve", exact: true })
          .click();
        await otherReview
          .getByRole("button", {
            name: "Confirm approval in wallet",
            exact: true,
          })
          .click();
      }
      await expect(
        otherReview.getByRole("region", {
          name: /QA Treasury approval group approvals/,
        }),
      ).toContainText("2 of 2 approvals received");
      await inspect(
        other,
        "two-approvals-mobile-dark",
        otherReview.getByRole("region", {
          name: /QA Treasury approval group approvals/,
        }),
      );
    } else {
      assert.ok(
        current.nativeExecution?.walletRejectedAt && !current.txHash,
        "Only an explicitly wallet-declined original attempt can resume",
      );
    }
    await first.reload();
    lastPage = first;
    if ((await getPayment()).status === "proposed")
      await review
        .getByRole("button", { name: "Send payment", exact: true })
        .click();
    await expect(
      review.getByRole("button", {
        name: "Retry original payment",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(review).not.toContainText(/Request Arguments|viem@/);
    await inspect(
      first,
      "send-declined-light",
      review.getByRole("button", {
        name: "Retry original payment",
        exact: true,
      }),
    );
    await first.reload();
    await review
      .getByRole("button", { name: "Retry original payment", exact: true })
      .click();
    await expect(review.getByText("Paid", { exact: true })).toBeVisible({
      timeout: 180000,
    });
    assert.equal(await paymentStatus(), true);
    await inspect(first, "settled-bill-light", review);
    await other.reload();
    await expect(otherReview.getByText("Paid", { exact: true })).toBeVisible();
    await inspect(other, "settled-bill-mobile-dark", otherReview);
  }
  if (phase === "status") await paymentStatus();
  if (phase === "export") {
    assert.equal(await paymentStatus(), true);
    const config = await client.query(api.accounting.configuration, scope);
    assert.ok(config.profile.bookName.startsWith("QA synthetic"));
    assert.equal(config.profile.currency, "USD");
    const chart = Object.fromEntries(
      config.accounts.map((row) => [row.externalId, row._id]),
    );
    let item;
    for (let attempt = 0; attempt < 20 && !item; attempt++) {
      const data = await client.query(api.reports.getTransactionReport, {
        ...scope,
        environment: "test",
        pageSize: 100,
      });
      item = data.items.find(
        (row) =>
          row.txHash === journal.txHash &&
          row.kind === "payment" &&
          row.includedInTotals,
      );
      if (!item) await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    assert.ok(item, "The original settled payment has not reached reports yet");
    journal.source = { kind: "activity", id: item.rowId };
    save();
    const page = await open(owner, "light");
    await page.goto(`${baseURL}/org/${orgId}/reports`);
    await page
      .getByRole("button", { name: "Reconciliation", exact: true })
      .click();
    let details = await client.query(api.accounting.sourceDetails, {
      ...scope,
      source: journal.source,
    });
    if (!details.entry) {
      const row = page
        .getByRole("row")
        .filter({ has: page.getByText("0.01 USDC", { exact: true }) })
        .filter({ hasText: item.accountAddress.slice(0, 8) })
        .filter({ hasText: "QA Employee Complete" })
        .filter({ hasText: "Sent" });
      await expect(row).toHaveCount(1);
      await row
        .getByRole("button", { name: "Review with books", exact: true })
        .click();
      const review = page.getByRole("dialog", {
        name: "Reconcile with your books",
      });
      await expect(review).toContainText(journal.invoiceNumber);
      await review
        .getByLabel("How is this recorded in your books?")
        .selectOption("existing_payable");
      await review
        .getByLabel("Holding account in your books")
        .selectOption(chart["qa-treasury"]);
      await review
        .getByLabel("Offset account in your books")
        .selectOption(chart["qa-payable"]);
      await review
        .getByLabel("Book / obligation reference")
        .fill(journal.invoiceNumber);
      await review
        .getByLabel("Asset book value · USD", { exact: true })
        .fill("0.01");
      await review
        .getByLabel("Obligation settled · USD", { exact: true })
        .fill("0.01");
      await review
        .getByLabel("Vendor or customer name in the books")
        .fill("QA Employee Complete");
      await review
        .getByLabel("Book value evidence")
        .fill(
          "Synthetic QA book value of 0.01 USD for workflow testing; not a market price, GAAP policy or external ledger entry.",
        );
      await expect(
        review.getByRole("button", { name: "Prepare journal", exact: true }),
      ).toBeDisabled();
      await review
        .getByRole("checkbox", {
          name: /^I reviewed the book values/,
        })
        .check();
      await inspect(
        page,
        "journal-review-light",
        review.getByRole("button", { name: "Prepare journal", exact: true }),
      );
      await review
        .getByRole("button", { name: "Prepare journal", exact: true })
        .click();
      await expect(review).toContainText("Ready to export");
      details = await client.query(api.accounting.sourceDetails, {
        ...scope,
        source: journal.source,
      });
      await review
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    }
    assert.equal(details.entry.treatment, "existing_payable");
    assert.equal(details.entry.fact.amountRaw, "10000");
    assert.equal(details.entry.lines.length, 2);
    assert.ok(
      details.entry.lines.every((line) =>
        ["asset", "payable"].includes(line.account.kind),
      ),
    );
    journal.entryId = details.entry._id;
    journal.journalNumber = details.entry.journalNumber;
    save();
    await page.getByRole("button", { name: "Journals", exact: true }).click();
    const row = page
      .getByRole("row")
      .filter({ hasText: journal.journalNumber });
    if (!details.entry.exportId) {
      await row
        .getByRole("checkbox", {
          name: `Export ${journal.journalNumber}`,
          exact: true,
        })
        .check();
      await page
        .getByRole("button", { name: "Prepare export · 1", exact: true })
        .click();
    } else
      await row
        .getByRole("button", { name: "Open original export", exact: true })
        .click();
    const exported = page.getByRole("dialog", { name: "Journal export" });
    await expect(exported).toBeVisible();
    for (const [button, name] of [
      ["Download journal CSV", "journals"],
      ["Download reconciliation evidence", "evidence"],
    ]) {
      const download = page.waitForEvent("download");
      await exported.getByRole("button", { name: button, exact: true }).click();
      const path = `${dir}/${name}.csv`;
      await (await download).saveAs(path);
      const rows = parseCsvRecords(readFileSync(path, "utf8"));
      assert.equal(rows.length, 3);
      if (name === "journals") {
        assert.ok(
          rows.slice(1).every((values) => values[0] === journal.journalNumber),
        );
        const debit = rows[0].indexOf("Debits"),
          credit = rows[0].indexOf("Credits");
        assert.equal(
          rows
            .slice(1)
            .reduce(
              (sum, values) =>
                sum +
                Math.round(Number(values[debit] || "0") * 100) -
                Math.round(Number(values[credit] || "0") * 100),
              0,
            ),
          0,
        );
      } else {
        const hash = rows[0].indexOf("transaction_hash"),
          raw = rows[0].indexOf("raw_units");
        assert.ok(
          rows
            .slice(1)
            .every(
              (values) =>
                values[hash] === journal.txHash && values[raw] === "10000",
            ),
        );
      }
    }
    await inspect(page, "export-light", exported);
    details = await client.query(api.accounting.sourceDetails, {
      ...scope,
      source: journal.source,
    });
    journal.exportId = details.entry.exportId;
    assert.ok(journal.exportId);
    const saved = await client.query(api.accounting.exportDetails, {
      exportId: journal.exportId,
      sessionToken: token,
    });
    assert.equal(saved.entries.length, 1);
    assert.equal(saved.batch.importedAt, undefined);
    assert.equal(saved.entries[0].state, "exported");
    journal.complete = true;
    journal.completedAt = new Date().toISOString();
    save();
    pass(
      "Built-app reviewed payable export balances, retains exact receipt evidence and remains unconfirmed until a real ledger import",
    );
  }
  if (phase === "inspect") {
    assert.equal(journal.complete, true);
    for (const theme of ["light", "dark"]) {
      const page = await open(owner, theme);
      await page.goto(
        `${baseURL}/org/${orgId}/disbursements?focus=${journal.disbursementId}`,
      );
      await expect(
        page.getByRole("dialog", { name: "Payment details" }),
      ).toContainText("Paid");
      await inspect(page, `final-payment-${theme}`);
    }
  }
} catch (error) {
  writeFileSync(`${dir}/failure.txt`, String(error?.stack ?? error), {
    mode: 0o600,
  });
  if (lastPage) {
    await lastPage
      .screenshot({ path: `${dir}/failure.png`, fullPage: true })
      .catch(() => {});
    writeFileSync(
      `${dir}/failure-ui.txt`,
      await lastPage
        .locator("body")
        .innerText()
        .catch(() => ""),
      { mode: 0o600 },
    );
  }
  console.error(
    `Finance-cycle ${phase} stopped; inspect the private failure record. No automatic retry was performed.`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await Promise.allSettled(
    sessions.map((value) => client.mutation(api.auth.logout, { token: value })),
  );
}
