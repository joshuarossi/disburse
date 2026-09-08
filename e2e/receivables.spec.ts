import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const path = `/pay/${"a".repeat(64)}`;

test("an unavailable invoice connection offers recovery without payment instructions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("qa:offline-initialized")) return;
    sessionStorage.setItem("qa:offline-initialized", "true");
    sessionStorage.setItem("qa:scenario", "ar-public-offline");
  });
  await page.clock.install();
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Loading invoice", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(10_100);
  await expect(
    page.getByRole("heading", { name: "Invoice taking longer to load" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload invoice" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy address" })).toHaveCount(
    0,
  );
  await page.evaluate(() => sessionStorage.removeItem("qa:scenario"));
  await page.getByRole("button", { name: "Reload invoice" }).click();
  await expect(
    page.getByRole("heading", { name: "Northstar Studio", exact: true }),
  ).toBeVisible();
});

test("invoice editor calculates the total and presents collection costs before issuance", async ({
  page,
}) => {
  await page.goto("/org/demo/receivables");
  await expect(
    page.getByRole("heading", { name: "Invoices", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create invoice", exact: true })
    .click();
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Example customer");
  await page.getByLabel("Invoice number", { exact: true }).fill("INV-1044");
  await page.getByLabel("Item 1", { exact: true }).fill("Services");
  await page.getByLabel("Quantity 1", { exact: true }).fill("3");
  await page.getByLabel("Unit price 1", { exact: true }).fill("0.010001");
  await expect(page.getByText("$0.030003 USDC", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "INV-2026-1043", exact: true })
    .click();
  await expect(
    page.getByText("Collection costs", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/first collection also activates/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate payment link" }),
  ).toBeEnabled();
});

test("customer sees remaining balance, exact currency/network, address and line amounts without signing in", async ({
  page,
}) => {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Northstar Studio", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Partially paid", { exact: true })).toBeVisible();
  await expect(page.getByText("1000 USDC", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy address" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Invoice receiving address" }),
  ).toBeVisible();
  await expect(page.getByText("accounts@example.invalid")).toHaveCount(0);
  await page.getByText("Verify currency contract", { exact: true }).click();
  await expect(
    page.getByText("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", {
      exact: true,
    }),
  ).toBeVisible();
});

for (const [scenario, heading] of [
  ["ar-paid", "Payment received"],
  ["ar-void", "Invoice voided"],
]) {
  test(`${scenario}: the public page stops requesting further payment`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => sessionStorage.setItem("qa:scenario", value),
      scenario,
    );
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy address" }),
    ).toHaveCount(0);
    if (scenario === "ar-void") {
      await page.goto("/org/demo/receivables");
      await expect(
        page.getByRole("row").filter({ hasText: "INV-2026-1043" }),
      ).toContainText("No collection due");
    }
  });
}

for (const theme of ["light", "dark"]) {
  for (const route of ["/org/demo/receivables", path]) {
    test(`${theme}: ${route.startsWith("/pay") ? "customer invoice" : "invoice workspace"} is accessible at 320px`, async ({
      page,
    }) => {
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (route.startsWith("/pay")) {
        const lines = page.getByRole("list", {
          name: "Invoice line items",
          exact: true,
        });
        await expect(lines).toBeVisible();
        await expect(
          lines.getByText("$1,500.00", { exact: true }),
        ).toBeVisible();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    });
  }
  test(`${theme}: draft form and review have accessible controls`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto("/org/demo/receivables");
    await page
      .getByRole("button", { name: "Create invoice", exact: true })
      .click();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "INV-2026-1043", exact: true })
      .click();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
}

test("invoice print view keeps the document and hides interactive controls", async ({
  page,
}) => {
  await page.goto(path);
  await expect(
    page.getByRole("button", { name: "Print / save PDF" }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("button", { name: "Print / save PDF" }),
  ).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "INV-2026-1042", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("0x4444444444444444444444444444444444444444", {
      exact: true,
    }),
  ).toBeVisible();
});
