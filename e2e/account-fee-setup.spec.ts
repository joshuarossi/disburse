import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function open(page: Page, scenario: string, theme = "dark") {
  await page.addInitScript(
    ({ scenario, theme }) => {
      localStorage.setItem("theme", theme);
      sessionStorage.setItem("qa:scenario", `account-fee-${scenario}`);
    },
    { scenario, theme },
  );
  await page.goto("/org/demo/settings?tab=safe");
  const section = page
    .getByRole("region", { name: /Execution fees for/ })
    .first();
  await section
    .getByRole("button", { name: "Execution fee setup", exact: true })
    .click();
  return section;
}
async function ready(page: Page, scenario: string, theme = "dark") {
  const section = await open(page, scenario, theme);
  await section
    .getByRole("button", { name: "Check fee support", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Prepare USDC fee setup", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Review account approvals", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Approve fee setup", exact: true })
    .click();
  await section.getByRole("checkbox").check();
  return section;
}
test("existing account setup preserves approvals after wallet rejection and fits a phone", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const section = await ready(page, "declined");
  await section
    .getByRole("button", { name: "Complete setup in MetaMask" })
    .click();
  await expect(section.getByRole("status")).toContainText(
    "Wallet confirmation cancelled",
  );
  await expect(section.getByRole("alert")).toHaveCount(0);
  await expect(section).not.toContainText("Request Arguments");
  await expect(
    section.getByRole("button", { name: "Review account approvals" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("qa:fee-wallet-submissions"),
    ),
  ).toBeNull();
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("fee-setup-declined-mobile-dark.png"),
  });
});
test("lost wallet response stays recoverable after reload without a second submission", async ({
  page,
}) => {
  let section = await ready(page, "unknown");
  await section
    .getByRole("button", { name: "Complete setup in MetaMask" })
    .click();
  await expect(section.getByRole("alert")).toContainText(
    "wallet response was interrupted",
  );
  await page.reload();
  section = page.getByRole("region", { name: /Execution fees for/ }).first();
  await section
    .getByRole("button", { name: "Execution fee setup", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "Complete setup in MetaMask" }),
  ).toHaveCount(0);
  await expect(
    section.getByRole("button", { name: "Restore unsubmitted wallet step" }),
  ).toHaveCount(0);
  await section
    .getByRole("button", { name: "Check setup receipt", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("qa:fee-wallet-submissions"),
    ),
  ).toBe("1");
});
for (const scenario of ["claim-response-lost", "decline-save-failed"])
  test(`restores an unsubmitted step after ${scenario}`, async ({ page }) => {
    const section = await ready(page, scenario);
    await section
      .getByRole("button", { name: "Complete setup in MetaMask" })
      .click();
    await expect(section.getByRole("alert")).toBeVisible();
    await section
      .getByRole("button", { name: "Restore unsubmitted wallet step" })
      .click();
    await expect(
      section.getByRole("button", { name: "Review account approvals" }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("qa:fee-wallet-submissions"),
      ),
    ).toBeNull();
  });
test("a failed database claim opens no submitting wallet prompt", async ({
  page,
}) => {
  const section = await ready(page, "claim-failed");
  await section
    .getByRole("button", { name: "Complete setup in MetaMask" })
    .click();
  await expect(section.getByRole("alert")).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:fee-wallet-attempts")),
  ).toBeNull();
});
test("a verified setup closes the pending request and can check the current configuration", async ({
  page,
}, info) => {
  const section = await ready(page, "success", "light");
  await section
    .getByRole("button", { name: "Complete setup in MetaMask" })
    .click();
  await section
    .getByRole("button", { name: "Check setup receipt", exact: true })
    .click();
  await expect(section).toContainText("Account fee setup completed");
  await section
    .getByRole("button", { name: "Check fee support", exact: true })
    .click();
  await expect(section).toContainText("ready to pay execution fees in USDC");
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("fee-setup-complete-light.png"),
  });
});
test("already configured accounts do not ask for another paid setup", async ({
  page,
}) => {
  const section = await open(page, "already-ready");
  await section
    .getByRole("button", { name: "Check fee support", exact: true })
    .click();
  await expect(section).toContainText("ready to pay execution fees in USDC");
  await expect(
    section.getByRole("button", {
      name: "Prepare USDC fee setup",
      exact: true,
    }),
  ).toHaveCount(0);
});
for (const scenario of ["outage", "custom-handler"])
  test(`fee support check handles ${scenario} before approvals`, async ({
    page,
  }) => {
    const section = await open(page, scenario);
    await section
      .getByRole("button", { name: "Check fee support", exact: true })
      .click();
    await expect(section.getByRole("alert")).toBeVisible();
    await expect(section).not.toContainText("rpc.invalid");
    await expect(
      section.getByRole("button", {
        name: "Prepare USDC fee setup",
        exact: true,
      }),
    ).toHaveCount(0);
  });
