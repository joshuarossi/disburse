import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});
test("workspace admins cannot enter the operator console", async ({ page }) => {
  await page.goto("/admin/licenses");
  await expect(
    page.getByRole("heading", { name: "Operator access required" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save company license" }),
  ).toHaveCount(0);
  await expect(page.getByText("Northstar Studio", { exact: true })).toHaveCount(
    0,
  );
});
for (const [theme, width] of [
  ["light", 1440],
  ["dark", 430],
] as const) {
  test(`an operator creates a permanent free tier and grants it in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript((theme) => {
      localStorage.setItem("theme", theme);
      sessionStorage.setItem("qa:scenario", "license-operator");
    }, theme);
    await page.goto("/admin/licenses");
    await page.getByRole("button", { name: "Free tiers", exact: true }).click();
    await page.getByLabel("New tier name").fill("Community");
    await page.getByLabel("Member seats", { exact: true }).fill("3");
    await page.getByLabel("Saved recipients", { exact: true }).fill("");
    await page
      .getByLabel("Reason for creating this tier")
      .fill("Permanent free access for our pilot program");
    await page.getByRole("button", { name: "Create free tier" }).click();
    await expect(page.getByRole("status")).toContainText("Free tier created");
    await page.getByRole("button", { name: "Companies", exact: true }).click();
    await page.getByRole("button", { name: "Northstar Studio demo" }).click();
    await page.getByLabel("Access arrangement").selectOption("complimentary");
    await page
      .getByLabel("Access tier", { exact: true })
      .selectOption({ label: "Community" });
    await expect(page.getByLabel("Never expires")).toBeChecked();
    await page
      .getByLabel("Free tier after trial or paid access ends")
      .selectOption({ label: "Community" });
    await expect(page.locator('[aria-label="License preview"]')).toContainText(
      "3 member seats · unlimited saved recipients",
    );
    await page
      .getByLabel("Reason for this change")
      .fill("Pilot customer, no subscription charge");
    await page.getByRole("button", { name: "Save company license" }).click();
    await expect(page.getByRole("status")).toContainText(
      "No subscription payment was created",
    );
    await expect(
      page.getByText("Current access: Community · No subscription charge"),
    ).toBeVisible();
    const submitted = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("qa:lastMutation")!),
    );
    expect(submitted.args.expiresAt).toBeUndefined();
    expect(submitted.args.tierKey).toBe("custom-free-tier");
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
      path: `.local/qa/license-operator-${theme}.png`,
      fullPage: true,
    });
  });
}
test("an operator can extend a trial and configure future signups without changing existing access", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "license-operator"),
  );
  await page.goto("/admin/licenses");
  await page.getByRole("button", { name: "Northstar Studio demo" }).click();
  await page.getByLabel("Access arrangement").selectOption("trial");
  await page.getByLabel("Access tier", { exact: true }).selectOption("pro");
  const date = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 16);
  await page.getByLabel("Access ends, your local time").fill(date);
  await page
    .getByLabel("Reason for this change")
    .fill("Extend evaluation through the next payroll cycle");
  await page.getByRole("button", { name: "Save company license" }).click();
  await expect(page.getByRole("status")).toContainText("Company license saved");
  await page
    .getByRole("button", { name: "Signup program", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use 30 days Pro, then Free" })
    .click();
  await expect(page.getByLabel("Trial length in days")).toHaveValue("30");
  await expect(page.getByLabel("Trial tier", { exact: true })).toHaveValue(
    "pro",
  );
  await page
    .getByLabel("Reason for the signup change")
    .fill("Thirty day Pro trial, permanent free core");
  await page.getByRole("button", { name: "Save signup program" }).click();
  await expect(page.getByRole("status")).toContainText("future companies");
  await page.getByRole("button", { name: "Companies", exact: true }).click();
  await page.getByRole("button", { name: "Northstar Studio demo" }).click();
  await expect(page.getByLabel("Access ends, your local time")).toHaveValue(
    date,
  );
});
for (const scenario of ["license-free", "license-complimentary"]) {
  test(`${scenario} has no false expiry warning and discloses customer fees`, async ({
    page,
  }) => {
    await page.addInitScript(
      (scenario) => sessionStorage.setItem("qa:scenario", scenario),
      scenario,
    );
    await page.goto("/org/demo/settings?tab=billing");
    await expect(
      page.getByText("No subscription charge", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("You pay all network and provider fees.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Subscription ended", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("0 days remaining", { exact: false }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Renew for 30 days" }),
    ).toHaveCount(0);
    const included = page.getByRole("button", {
      name: "Included at no charge",
    });
    await expect(included).toHaveCount(
      scenario === "license-complimentary" ? 2 : 0,
    );
    for (const button of await included.all())
      await expect(button).toBeDisabled();
    await expect(
      page.getByText("Payment history", { exact: true }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: `.local/qa/${scenario}-billing.png`,
      fullPage: true,
    });
  });
}
test("a Pro trial explains the free fallback instead of requiring payment to keep paying", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "license-trial"),
  );
  await page.goto("/org/demo/settings?tab=billing");
  await expect(
    page.getByText("After this period, Free access continues automatically.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Free access continues after this period.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Renew to submit new payments.", { exact: false }),
  ).toHaveCount(0);
});
