/** Read-only visual review of actual built pages in the isolated QA workspace.
 * The wallet can sign in; financial signatures and sends are refused.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ConvexHttpClient } from "convex/browser";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { api } from "../convex/_generated/api.js";
import { openQaWallet } from "./lib/qaBrowserWallet.mjs";
assert.equal(process.env.CONVEX_DEPLOYMENT, "dev:fortunate-cat-122");
assert.equal(
  process.env.VITE_CONVEX_URL,
  "https://fortunate-cat-122.convex.cloud",
);
const orgId = "k575vpg8mtsn2126zbswdg4rfd8dvk88";
const baseURL = "http://127.0.0.1:4180";
const dir = ".local/qa/built-workspace-review";
mkdirSync(dir, { recursive: true, mode: 0o700 });
assert.equal((await fetch(baseURL)).status, 200);
const owner = privateKeyToAccount(
  JSON.parse(readFileSync(".local/qa/wallet.json")).privateKey,
);
const chain = createPublicClient({
  chain: sepolia,
  transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
});
const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, {
  logger: false,
});
const sessions = [],
  results = [];
const browser = await chromium.launch();
let lastPage;
try {
  for (const theme of ["light", "dark"]) {
    const page = await openQaWallet({
      browser,
      account: owner,
      chain,
      orgId,
      theme,
      baseURL,
      onSession: (token) => sessions.push(token),
      signTypedData: async () => {
        throw new Error("Read-only review: financial signing is disabled");
      },
      sendTransaction: async () => {
        throw new Error("Read-only review: transaction sending is disabled");
      },
    });
    lastPage = page;
    if (theme === "dark")
      await page.setViewportSize({ width: 390, height: 980 });
    for (const [route, heading] of [
      ["dashboard", "Overview"],
      ["beneficiaries", "Recipients"],
      ["invoices", "Bills"],
      ["receivables", "Invoices"],
      ["disbursements", "Payments"],
      ["payments", "Schedules"],
      ["treasury", "Accounts"],
      ["reports", "Reports"],
      ["team", "Team & approvals"],
      ["settings", "Settings"],
      ["settings?tab=billing", "Settings"],
    ]) {
      await page.goto(`${baseURL}/org/${orgId}/${route}`);
      await expect(
        page.getByRole("heading", { name: heading, level: 1, exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByText("Something went wrong", { exact: true }),
      ).toHaveCount(0);
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
      if (route.includes("billing"))
        await expect(
          page.getByRole("region", { name: "Workspace usage" }),
        ).toBeVisible({ timeout: 30000 });
      if (route === "beneficiaries")
        await expect(
          page.getByText("QA Employee Complete", { exact: true }),
        ).toBeVisible({ timeout: 30000 });
      if (route === "invoices")
        await page.getByRole("tab", { name: "Paid", exact: true }).click();
      if (route === "reports")
        await page
          .getByRole("button", { name: "Reconciliation", exact: true })
          .click();
      if (["dashboard", "treasury"].includes(route))
        await expect(
          page.getByText(
            /^(Checking…|Checking balances and account approvals…)$/,
          ),
        ).toHaveCount(0, { timeout: 45_000 });
      await expect(
        page.getByRole("status", { name: "Loading records" }),
      ).toHaveCount(0, {
        timeout: 30000,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route}: page overflow`,
      );
      const checks = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const file = `${theme}-${route.replace(/[^a-z]/g, "-")}.png`;
      await page.screenshot({ path: `${dir}/${file}`, fullPage: true });
      results.push({
        route,
        theme,
        file,
        violations: checks.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, html, failureSummary }) => ({
            target,
            html,
            failureSummary,
          })),
        })),
      });
      writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2), {
        mode: 0o600,
      });
      assert.deepEqual(
        checks.violations.map(({ id, impact }) => ({ id, impact })),
        [],
        `${route}: accessibility`,
      );
      console.log(
        `PASS ${theme}: ${route}, built page, accessibility and overflow`,
      );
    }
    await page.context().close();
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
    "Built workspace review stopped. Inspect its private failure record. No financial request was made.",
  );
  process.exitCode = 1;
} finally {
  await browser.close();
  await Promise.allSettled(
    sessions.map((token) => client.mutation(api.auth.logout, { token })),
  );
}
