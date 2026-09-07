import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const output = ".local/qa/screenshots";
const invoiceOnly = process.argv.includes('--receivables');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === "http://127.0.0.1:5174"
        ? route.continue()
        : route.abort(),
    );
    for (const route of invoiceOnly ? ['receivables'] : [
      "dashboard",
      "beneficiaries",
      "disbursements",
      "invoices",
      "receivables",
      "payments",
      "treasury",
      "team",
      "settings",
      "reports",
    ]) {
      await page.goto(`http://127.0.0.1:5174/org/demo/${route}`);
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.getByText("Preview · sample data · read-only").waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `${output}/${theme}-${route}.png`,
        fullPage: true,
      });
    }
    if (invoiceOnly) {
      await page.getByRole('button', { name: 'INV-2026-1043', exact: true }).click();
      await page.getByText('Collection costs', { exact: true }).waitFor();
      await page.screenshot({ path: `${output}/${theme}-invoice-review.png`, fullPage: true });
      await page.goto(`http://127.0.0.1:5174/pay/${'a'.repeat(64)}`);
      await page.getByRole('heading', { name: 'Northstar Studio', exact: true }).waitFor();
      await page.screenshot({ path: `${output}/${theme}-customer-invoice.png`, fullPage: true });
      await page.setViewportSize({ width: 320, height: 900 });
      await page.screenshot({ path: `${output}/${theme}-mobile-customer-invoice.png`, fullPage: true });
      await context.close();
      continue;
    }
    await page.goto("http://127.0.0.1:5174/org/demo/disbursements?new=1");
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: `${output}/${theme}-payment-builder.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://127.0.0.1:5174/org/demo/dashboard");
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.screenshot({
      path: `${output}/${theme}-mobile-overview.png`,
      fullPage: true,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`Saved screenshots to ${output}`);
