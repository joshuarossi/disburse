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
    `circle-schedule-${scenario}`,
  );
  await page.goto("/org/demo/disbursements?focus=p1");
  const schedule = page.getByRole("region", {
    name: "Scheduled payment",
    exact: true,
  });
  await expect(
    page.getByRole("button", { name: "Review in wallet", exact: true }),
  ).toHaveCount(0);
  await schedule
    .getByRole("button", { name: "Review scheduled payment", exact: true })
    .click();
  return schedule;
}
async function approve(page: Page, submitLabel = "Schedule payment") {
  const fees = page.getByRole("region", { name: "Execution fees" });
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
  await expect(
    fees.getByRole("button", { name: submitLabel, exact: true }),
  ).toBeEnabled();
  return fees;
}

for (const theme of ["light", "dark"])
  test(`${theme}: a signed schedule survives reload without an immediate send action`, async ({
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
    const schedule = await start(page, "success");
    const fees = await approve(page);
    await fees
      .getByRole("button", { name: "Schedule payment", exact: true })
      .click();
    await expect(schedule).toContainText("Scheduled for automatic payment");
    await expect(
      page.getByRole("button", { name: "Send payment", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("qa:circle-submissions"),
      ),
    ).toBeNull();
    await page.reload();
    await expect(schedule).toContainText("Scheduled for automatic payment");
    await expect(
      fees.getByRole("button", { name: "Schedule payment", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Change date", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Edit draft", exact: true }),
    ).toHaveCount(0);
    expect(
      await schedule.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await schedule.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`scheduled-${theme}.png`),
      fullPage: true,
    });
  });

test("declining an approval keeps an unarmed schedule and displays a neutral cancellation notice", async ({
  page,
}) => {
  const schedule = await start(page, "declined");
  const fees = schedule.getByRole("region", { name: "Execution fees" });
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
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("qa:schedule")!).status,
    ),
  ).toBe("review");
  await expect(page.locator("body")).not.toContainText("Request Arguments");
});

test("an unsigned schedule can be cancelled without requesting a wallet signature", async ({
  page,
}) => {
  const schedule = await start(page, "success");
  await schedule
    .getByRole("button", { name: "Cancel scheduled payment", exact: true })
    .click();
  await schedule
    .getByRole("button", { name: "Continue cancellation", exact: true })
    .click();
  await expect(schedule).toContainText("This scheduled payment is cancelled");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBeNull();
  await schedule
    .getByRole("button", { name: "Return payment to draft", exact: true })
    .click();
  await expect(
    schedule.getByRole("button", {
      name: "Review scheduled payment",
      exact: true,
    }),
  ).toBeEnabled();
});

test("a signed cancellation requires its own fee review before it becomes final", async ({
  page,
}) => {
  const schedule = await start(page, "cancel-success");
  await approve(page);
  await schedule
    .getByRole("button", { name: "Cancel scheduled payment", exact: true })
    .click();
  await schedule
    .getByRole("button", { name: "Continue cancellation", exact: true })
    .click();
  await expect(schedule).toContainText(
    "Pausing alone does not revoke its authorization",
  );
  await expect(schedule).not.toContainText(
    "This scheduled payment is cancelled",
  );
  const fees = await approve(page, "Confirm cancellation");
  await fees
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await fees
    .getByRole("button", { name: "Check execution status", exact: true })
    .click();
  await expect(schedule).toContainText("This scheduled payment is cancelled");
  await expect(fees).toContainText("Actual fee charged");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-submissions")),
  ).toBe("1");
});

test("an insufficient balance leaves the reviewed date and recipients intact", async ({
  page,
}) => {
  const schedule = await start(page, "insufficient");
  await schedule
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await expect(schedule.getByRole("alert")).toContainText("enough USDC");
  await expect(
    schedule.getByRole("button", { name: "Review execution fee", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBeNull();
});
