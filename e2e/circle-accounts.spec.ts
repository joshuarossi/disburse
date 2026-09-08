import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function start(page: Page, scenario: string) {
  await page.addInitScript((value) => {
    localStorage.setItem("theme", "dark");
    sessionStorage.setItem("qa:scenario", value);
  }, `circle-account-${scenario}`);
  await page.goto("/org/demo/settings?tab=safe");
  await page
    .getByRole("button", { name: "Create company account", exact: true })
    .click();
  await page.getByLabel("Account name", { exact: true }).fill("Payroll");
  await page
    .getByRole("button", { name: "Review account setup", exact: true })
    .click();
  return page.getByRole("region", { name: "Execution fees" });
}
test("cancelled account creation shows a neutral message, preserves the name and fits a phone", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fees = await start(page, "declined");
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await fees.getByRole("checkbox").check();
  await fees
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await expect(fees.getByRole("status")).toContainText(
    "Wallet confirmation cancelled",
  );
  await expect(fees.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBeNull();
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  expect(await fees.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await fees.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("account-declined-mobile.png"),
  });
});
test("an unknown account creation restores after reload without another paid request", async ({
  page,
}) => {
  const fees = await start(page, "unknown");
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await fees.getByRole("checkbox").check();
  await fees
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Approve execution", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Create company account", exact: true })
    .click();
  await expect(fees.getByRole("alert")).toContainText(
    "original execution request is saved",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Review account setup", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Payroll");
  await expect(
    fees.getByRole("button", { name: "Create company account", exact: true }),
  ).toHaveCount(0);
  await expect(
    fees.getByRole("button", { name: "Review execution fee", exact: true }),
  ).toHaveCount(0);
  await expect(
    fees.getByRole("button", { name: "Check execution status" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});
test("a completed deployment connects its named account and closes the setup", async ({
  page,
}) => {
  const fees = await start(page, "success");
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await fees.getByRole("checkbox").check();
  await fees
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Approve execution", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Create company account", exact: true })
    .click();
  await fees.getByRole("button", { name: "Check execution status" }).click();
  await expect(page.getByRole("dialog")).toContainText("Payroll is ready");
  await expect(page.getByRole("dialog")).toContainText(
    "The account starts empty",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review account setup", exact: true }),
  ).toHaveCount(0);
});
test("a failed network check keeps the account form and shows a readable error", async ({
  page,
}) => {
  await start(page, "prepare-outage");
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Could not complete account setup",
  );
  await expect(page.getByLabel("Account name", { exact: true })).toHaveValue(
    "Payroll",
  );
  await expect(page.getByRole("dialog")).not.toContainText("rpc.invalid");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBeNull();
});
