import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
for (const language of ["es", "pt-BR"]) {
  const messages = JSON.parse(
    readFileSync(
      new URL(`../src/locales/${language}/workspace.json`, import.meta.url),
      "utf8",
    ),
  );
  const text = (key: string): string => {
    if (!messages[key])
      throw new Error(`Missing ${language} test message: ${key}`);
    return messages[key];
  };
  async function initialize(page: Page) {
    await page.addInitScript((value) => {
      localStorage.setItem("i18nextLng", value);
      localStorage.setItem("theme", "dark");
    }, language);
    await page.route("**/*", (route) =>
      ["localhost", "127.0.0.1"].includes(
        new URL(route.request().url()).hostname,
      )
        ? route.continue()
        : route.abort(),
    );
  }
  test(`${language} a wallet decline preserves setup funds and shows a localized neutral message`, async ({
    page,
  }, testInfo) => {
    await initialize(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() =>
      sessionStorage.setItem("qa:scenario", "customer-setup-declined"),
    );
    await page.goto("/onboarding");
    await page.getByLabel(text("Name"), { exact: true }).fill("Alex Morgan");
    await page
      .getByRole("button", { name: text("Continue"), exact: true })
      .click();
    await page
      .getByLabel(text("Organization name"), { exact: true })
      .fill("Setup QA");
    await page
      .getByRole("button", { name: text("Create organization"), exact: true })
      .click();
    await page
      .getByRole("button", { name: text("Skip for now"), exact: true })
      .click();
    await page.getByRole("button", { name: text("No, create one") }).click();
    await page.getByLabel(text("Chain"), { exact: true }).selectOption("8453");
    await page
      .getByLabel(text("Deposit into company account (USDC)"))
      .fill("10");
    await page
      .getByRole("button", { name: text("Review setup"), exact: true })
      .click();
    await expect(page.getByLabel(text("Setup review"))).toContainText(
      "10 USDC",
    );
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", {
        name: text("Confirm setup in MetaMask"),
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toContainText(
      text(
        "Wallet confirmation cancelled. Your account settings and deposit amount are saved.",
      ),
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(
      await page.evaluate(() => sessionStorage.getItem("qa:submissions")),
    ).toBeNull();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("wallet-decline.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: text("Edit setup"), exact: true })
      .click();
    await expect(
      page.getByLabel(text("Deposit into company account (USDC)")),
    ).toHaveValue("10");
  });
  test(`${language} recipient import identifies duplicate records and keeps the source columns intact`, async ({
    page,
  }, testInfo) => {
    await initialize(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/org/demo/beneficiaries?import=1");
    const dialog = page.getByRole("dialog");
    await dialog.locator("input[type=file]").setInputFiles({
      name: "duplicate.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Employee ID,Name,Email\n0013,Jamie Rivera,jamie@example.com\n0013,Taylor Rivera,taylor@example.com",
      ),
    });
    await expect(
      dialog.getByText(
        text("Duplicate source ID, email or address in this file"),
      ),
    ).toHaveCount(2);
    await dialog
      .getByText(text("Match columns from your file"), { exact: true })
      .click();
    await expect(
      dialog.getByText("Employee ID", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog
        .getByRole("option", {
          name: text("Source employee or vendor ID"),
          exact: true,
        })
        .first(),
    ).toHaveCount(1);
    await expect(
      dialog.getByRole("option", {
        name: "Source employee or vendor ID",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", {
        name: language === "es" ? "Aplicar 0 cambios" : "Aplicar 0 alterações",
      }),
    ).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("import-duplicates.png"),
      fullPage: true,
    });
    expect(
      (
        await new AxeBuilder({ page })
          .include("dialog")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
}
