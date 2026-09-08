import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});
async function start(page: Page, scenario: string) {
  await page.addInitScript(
    (value) => sessionStorage.setItem("qa:scenario", value),
    `circle-${scenario}`,
  );
  await page.goto("/org/demo/disbursements?focus=p1");
  const fees = page.getByRole("region", { name: "Execution fees" });
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  return fees;
}
async function approveBoth(page: Page) {
  const fees = page.getByRole("region", { name: "Execution fees" });
  await fees.getByRole("checkbox").check();
  await fees
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await expect(
    fees.getByText("2. Approve the execution", { exact: true }),
  ).toBeVisible();
  await expect(fees.getByRole("checkbox")).toBeChecked();
  await fees.getByRole("checkbox").check();
  await fees
    .getByRole("button", { name: "Approve execution", exact: true })
    .click();
  await expect(
    fees.getByRole("button", { name: "Send payment", exact: true }),
  ).toBeVisible();
  await fees.getByRole("checkbox").check();
  return fees;
}
test('a new payment uses the current fee flow without a retired-provider loading panel', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'circle-draft'));
  await page.goto('/org/demo/disbursements?focus=p1');
  const payment = page.getByRole('dialog', { name: 'Payment details' });
  await expect(payment.getByRole('button', { name: 'Review in wallet', exact: true })).toBeEnabled();
  await expect(payment.getByText('Loading payment fee…', { exact: true })).toHaveCount(0);
  await expect(payment.getByRole('heading', { name: 'Payment fee', exact: true })).toHaveCount(0);
});
for (const theme of ["light", "dark"]) {
  test(`${theme}: cancelled fee approval preserves the payment and shows a neutral message`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.setViewportSize(
      theme === "dark"
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1100 },
    );
    const fees = await start(page, "declined");
    await expect(fees).toContainText("0.5 USDC");
    await expect(
      fees.getByRole("button", { name: "Approve fee limit", exact: true }),
    ).toBeDisabled();
    await fees.getByRole("checkbox").check();
    await fees
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await expect(fees.getByRole("status")).toContainText(
      "Wallet confirmation cancelled",
    );
    await expect(fees.getByRole("alert")).toHaveCount(0);
    await expect(
      fees.getByRole("button", { name: "Approve fee limit", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("qa:circle-submissions"),
      ),
    ).toBeNull();
    await expect(page.locator("body")).not.toContainText("Request Arguments");
    await expect(page.locator("body")).not.toContainText("viem@");
    expect(await fees.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await fees.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`fees-cancelled-${theme}.png`),
      fullPage: true,
    });
  });
}
test("an insufficient USDC balance stops before asking for an approval", async ({
  page,
}) => {
  const fees = await start(page, "insufficient");
  await expect(fees.getByRole("alert")).toContainText("enough USDC");
  await expect(
    fees.getByRole("button", { name: "Review execution fee", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBeNull();
});
test("the reviewed fee survives both approval steps and a successful request shows its actual cost", async ({
  page,
}) => {
  await start(page, "success");
  const fees = await approveBoth(page);
  await fees.getByRole("button", { name: "Send payment", exact: true }).click();
  await expect(fees).toContainText("checking the original transaction");
  await fees
    .getByRole("button", { name: "Check execution status", exact: true })
    .click();
  await expect(fees).toContainText("Actual fee charged");
  await expect(fees).toContainText("0.0075 USDC");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});
test("a lost submission response survives reload and offers only recovery", async ({
  page,
}) => {
  await start(page, "unknown");
  const fees = await approveBoth(page);
  await fees.getByRole("button", { name: "Send payment", exact: true }).click();
  await expect(fees.getByRole("alert")).toContainText(
    "original execution request is saved",
  );
  await page.reload();
  await expect(
    fees.getByRole("button", { name: "Send payment", exact: true }),
  ).toHaveCount(0);
  await expect(
    fees.getByRole("button", { name: "Review execution fee", exact: true }),
  ).toHaveCount(0);
  await fees
    .getByRole("button", { name: "Check execution status", exact: true })
    .click();
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});
test("a failed execution shows its real charge before allowing another fee review", async ({
  page,
}) => {
  await start(page, "failed");
  const fees = await approveBoth(page);
  await fees.getByRole("button", { name: "Send payment", exact: true }).click();
  await fees
    .getByRole("button", { name: "Check execution status", exact: true })
    .click();
  await expect(fees.getByRole("alert")).toContainText("fee above was charged");
  await expect(fees).toContainText("0.0075 USDC");
  await expect(
    fees.getByRole("button", { name: "Review execution fee", exact: true }),
  ).toBeEnabled();
});
test("an unreadable saved request cannot open another signing or submission flow", async ({
  page,
}) => {
  const fees = await start(page, "corrupt");
  await expect(fees.getByRole("alert")).toContainText(
    "saved fee request could not be read",
  );
  await expect(fees.getByRole("checkbox")).toHaveCount(0);
  await expect(
    fees.getByRole("button", { name: "Review execution fee", exact: true }),
  ).toHaveCount(0);
  await expect(
    fees.getByRole("button", { name: "Check execution status", exact: true }),
  ).toBeEnabled();
});
for (const scenario of ["wallet-changed", "save-failed"])
  test(`${scenario} keeps the original authorization and sends nothing`, async ({
    page,
  }) => {
    const fees = await start(page, scenario);
    await fees.getByRole("checkbox").check();
    await fees
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await expect(fees.getByRole("alert")).toBeVisible();
    await expect(
      fees.getByText("1. Approve the fee limit", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("qa:circle-submissions"),
      ),
    ).toBeNull();
    await expect(fees).not.toContainText("https://");
  });
test("expired approvals remain locked until recovery confirms non-execution", async ({
  page,
}) => {
  const fees = await start(page, "expired");
  await page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem("qa:circle")!);
    const r = JSON.parse(s.record);
    r.validUntil = Math.floor(Date.now() / 1000) - 1;
    s.record = JSON.stringify(r);
    sessionStorage.setItem("qa:circle", JSON.stringify(s));
  });
  await page.reload();
  await expect(fees.getByRole("checkbox")).toHaveCount(0);
  await expect(fees).toContainText("approval window has ended");
  await fees
    .getByRole("button", { name: "Check execution status", exact: true })
    .click();
  await expect(fees).toContainText("No execution fee was charged");
  await expect(
    fees.getByRole("button", { name: "Review execution fee", exact: true }),
  ).toBeEnabled();
});

for (const subject of ["policy", "cancellation"] as const) {
  test(`${subject} uses the same saved USDC fee flow and handles a declined confirmation`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 430, height: 1000 });
    await page.addInitScript(
      (value) => {
        localStorage.setItem("theme", "dark");
        sessionStorage.setItem("qa:scenario", value);
      },
      subject === "policy"
        ? "circle-policy-declined"
        : "circle-cancel-declined",
    );
    await page.goto("/org/demo/team");
    await page.getByRole("tab", { name: "Delegated spending" }).click();
    const fees = page.getByRole("region", { name: "Execution fees" });
    await fees
      .getByRole("button", { name: "Review execution fee", exact: true })
      .click();
    await fees.getByRole("checkbox").check();
    await fees
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await expect(fees.getByRole("status")).toContainText(
      `Your ${subject} and saved approvals are unchanged`,
    );
    await expect(fees.getByRole("alert")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("qa:circle-submissions"),
      ),
    ).toBeNull();
    await fees.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`${subject}-fees-dark-mobile.png`),
      fullPage: true,
    });
    expect(
      (
        await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(await fees.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  });
}
