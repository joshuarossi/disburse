import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function open(page: Page, scenario: string) {
  await page.addInitScript((value) => {
    localStorage.setItem("theme", "dark");
    sessionStorage.setItem("qa:scenario", value);
  }, `circle-billing-${scenario}`);
  await page.goto("/org/demo/settings?tab=billing");
  await page.getByRole("button", { name: "Renew for 30 days" }).click();
  await page
    .getByRole("button", { name: "Review subscription payment" })
    .click();
  const fees = page.getByRole("region", { name: "Execution fees" });
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  return fees;
}
test("cancelled subscription approval shows a neutral message and keeps the plan unchanged", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fees = await open(page, "declined");
  await fees.getByRole("checkbox").check();
  await fees
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await expect(fees.getByRole("status")).toContainText(
    "Wallet confirmation cancelled",
  );
  await expect(fees.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Pay with connected wallet" }),
  ).toHaveCount(0);
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
    path: testInfo.outputPath("subscription-declined-mobile.png"),
    fullPage: false,
  });
});
test("an unknown subscription submission survives reload without another request", async ({
  page,
}) => {
  const fees = await open(page, "unknown");
  await fees.getByRole("checkbox").check();
  await fees
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Approve execution", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Pay subscription", exact: true })
    .click();
  await expect(fees.getByRole("alert")).toContainText(
    "original execution request is saved",
  );
  await page.reload();
  await page.getByRole("button", { name: "Review saved checkout" }).click();
  await expect(
    fees.getByRole("button", { name: "Pay subscription", exact: true }),
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
test("a verified account payment applies the subscription and offers its receipt", async ({
  page,
}) => {
  const fees = await open(page, "success");
  await fees.getByRole("checkbox").check();
  await fees
    .getByRole("button", { name: "Approve fee limit", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Approve execution", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Pay subscription", exact: true })
    .click();
  await fees.getByRole("button", { name: "Check execution status" }).click();
  await expect(page.getByRole("dialog")).toContainText("Payment applied");
  await expect(
    page.getByRole("link", { name: "View receipt" }),
  ).toHaveAttribute("href", /basescan.org\/tx\/0x/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});
