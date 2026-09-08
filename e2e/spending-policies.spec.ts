import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});
for (const [theme, width] of [
  ["light", 1440],
  ["dark", 430],
] as const) {
  test(`a nested spending policy explains each approval and the fee in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript((theme) => {
      localStorage.setItem("theme", theme);
      sessionStorage.setItem("qa:scenario", "policy-nested");
    }, theme);
    await page.goto("/org/demo/team");
    await page.getByRole("tab", { name: "Delegated spending" }).click();
    const queue = page.getByRole("region", { name: "Policy approvals" });
    await expect(queue).toContainText("Payroll · 0 of 1 approvals");
    await expect(queue).toContainText("Treasury · 1 of 2 approvals");
    await expect(queue).toContainText("0.05 USDC");
    await expect(
      queue.getByRole("button", { name: "Apply policy" }),
    ).toBeDisabled();
    await queue.getByRole("checkbox").check();
    await queue.getByRole("button", { name: "Approve policy" }).click();
    const path = queue.getByRole("region", { name: "Choose approval account" });
    await expect(path).toContainText("Treasury → Payroll");
    await expect(path).toContainText("spending policy");
    await path.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.local/qa/policy-approval-${theme}.png`,
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
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await path
      .getByRole("button", { name: "Confirm approval in wallet" })
      .click();
    await expect(queue.getByRole("alert")).toContainText("read-only");
  });
}
test("a policy request preserves its allowance currency and reviews USDC execution fees after approval", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "policy-assigned"),
  );
  await page.goto("/org/demo/team");
  await page.getByRole("tab", { name: "Delegated spending" }).click();
  await page
    .getByRole("button", { name: "Set allowance", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Set delegated allowance" });
  await expect(
    dialog
      .getByRole("combobox", { name: "Assigned payment account" })
      .getByRole("option", { name: /Alex Morgan/ }),
  ).toHaveCount(1);
  await dialog
    .getByRole("combobox", { name: "Assigned payment account" })
    .selectOption("0x5555555555555555555555555555555555555555");
  await dialog
    .getByRole("textbox", { name: "Allowance", exact: true })
    .fill("250");
  await expect(dialog).toContainText(
    "company account pays the execution fee in USDC",
  );
  await expect(dialog).toContainText(
    "Review the exact limit after the account approves this policy",
  );
  await expect(
    dialog.getByRole("combobox", { name: "Execution fee" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "Currency", exact: true }),
  ).toHaveValue("USDC");
  await dialog.getByRole("checkbox").check();
  await expect(
    dialog.getByRole("button", { name: "Request account approval" }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Request account approval" })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("read-only");
});
test("an unavailable USDC fee keeps the policy saved without offering native gas", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "circle-policy-insufficient"),
  );
  await page.goto("/org/demo/team");
  await page.getByRole("tab", { name: "Delegated spending" }).click();
  const fees = page.getByRole("region", { name: "Execution fees" });
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await expect(fees.getByRole("alert")).toContainText("enough USDC");
  await expect(
    fees.getByRole("button", { name: "Review execution fee", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Apply policy", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBeNull();
});
test("changed policy state blocks approval and a declined send keeps its original retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("qa:scenario"))
      sessionStorage.setItem("qa:scenario", "policy-changed");
  });
  await page.goto("/org/demo/team");
  await page.getByRole("tab", { name: "Delegated spending" }).click();
  const queue = page.getByRole("region", { name: "Policy approvals" });
  await expect(queue).toContainText("changed after this request");
  await expect(
    queue.getByRole("button", { name: "Approve policy" }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    sessionStorage.setItem("qa:scenario", "policy-declined"),
  );
  await page.reload();
  await page.getByRole("tab", { name: "Delegated spending" }).click();
  await expect(queue).toContainText("Ready to retry");
  await queue.getByRole("checkbox").check();
  await expect(
    queue.getByRole("button", { name: "Retry original policy" }),
  ).toBeEnabled();
  await expect(
    queue.getByRole("button", { name: "Check policy confirmation" }),
  ).toBeEnabled();
});

test("the keyboard skip link stays hidden during pointer use and appears on focus", async ({
  page,
}) => {
  await page.goto("/org/demo/team");
  const link = page.getByRole("link", { name: "Skip to content" });
  await expect(link).toHaveCSS("opacity", "0");
  await link.focus();
  await expect(link).toHaveCSS("opacity", "1");
  await page.getByRole("tab", { name: "Delegated spending" }).click();
  await expect(link).toHaveCSS("opacity", "0");
});

test("archived accounts retain allowance inspection and revocation without new grants", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "policy-archived"),
  );
  await page.goto("/org/demo/team");
  await page.getByRole("tab", { name: "Delegated spending" }).click();
  await expect(
    page.getByRole("combobox", { name: "Funding account", exact: true }),
  ).toContainText("Archived");
  await expect(
    page.getByText("Existing allowances can still authorize transfers.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set allowance", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Revoke", exact: true }),
  ).toBeEnabled();
});
