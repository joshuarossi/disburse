import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("qa:scenario"))
      sessionStorage.setItem("qa:scenario", "billing-checkout");
  });
});

for (const theme of ["light", "dark"])
  test(`a saved server request is recoverable without local browser history in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: theme === "dark" ? 430 : 1440,
      height: 1000,
    });
    await page.addInitScript(
      ({ theme }) => {
        localStorage.setItem("theme", theme);
        sessionStorage.setItem("qa:scenario", "billing-server-requested");
      },
      { theme },
    );
    await page.goto("/org/demo/settings?tab=billing");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("disburse:pending-billing:demo"),
      ),
    ).toBeNull();
    await page.getByRole("button", { name: "Review saved checkout" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("region", { name: "Subscription payment recovery" }),
    ).toBeVisible();
    await expect(dialog).toContainText("USDC on Sepolia");
    await dialog
      .getByRole("button", { name: "Check original payment" })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("read-only");
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `.local/qa/story-billing-server-${theme}.png`,
    });
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Pay with connected wallet" }),
    ).toBeDisabled();
    await page.reload();
    await page.getByRole("button", { name: "Review saved checkout" }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Check original payment" }),
    ).toBeVisible();
  });

test("another administrator can inspect an unsubmitted checkout without paying from the wrong wallet", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "billing-server-other-payer"),
  );
  await page.goto("/org/demo/settings?tab=billing");
  await page.getByRole("button", { name: "Review saved checkout" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Connect the administrator wallet that prepared it",
  );
  await expect(
    dialog.getByRole("button", { name: "Pay with connected wallet" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Discard unsubmitted checkout" }),
  ).toBeEnabled();
});

test("an unknown wallet response keeps checkout blocked after reload on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem(
      "disburse:pending-billing:demo",
      JSON.stringify({
        plan: "team",
        attemptId: "interrupted-request",
        startedAt: Date.now(),
        chainId: 11155111,
      }),
    );
  });
  await page.goto("/org/demo/settings?tab=billing");
  await page.getByRole("button", { name: "Renew for 30 days" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "An earlier wallet request has no receipt yet",
  );
  await expect(dialog.getByLabel("Payment transaction hash")).toHaveValue("");
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Pay with connected wallet" }),
  ).toBeDisabled();
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  await page.screenshot({ path: ".local/qa/story-billing-unknown-dark.png" });
  await page.reload();
  await page.getByRole("button", { name: "Renew for 30 days" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "An earlier wallet request has no receipt yet",
  );
});

test("unreadable billing recovery does not offer another wallet payment", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("disburse:pending-billing:demo", "{truncated"),
  );
  await page.goto("/org/demo/settings?tab=billing");
  await page.getByRole("button", { name: "Renew for 30 days" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "earlier billing request could not be read",
  );
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Pay with connected wallet" }),
  ).toBeDisabled();
});

test("checkout in another tab prevents a concurrent send", async ({
  page,
  context,
}) => {
  await page.goto("/org/demo/settings?tab=billing");
  await page.evaluate(
    () =>
      new Promise<void>((acquired) => {
        void navigator.locks.request(
          "disburse:billing-checkout:demo",
          () => new Promise<void>(() => acquired()),
        );
      }),
  );
  const other = await context.newPage();
  await other.goto("/org/demo/settings?tab=billing");
  await other.getByRole("button", { name: "Renew for 30 days" }).click();
  const dialog = other.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Pay with connected wallet" })
    .click();
  await expect(dialog).toContainText(
    "Subscription checkout is already open in another tab",
  );
  expect(
    await other.evaluate(() =>
      localStorage.getItem("disburse:pending-billing:demo"),
    ),
  ).toBeNull();
  await other.screenshot({
    path: ".local/qa/story-billing-concurrent-light.png",
  });
  await page.close();
});

test("subscription checkout resumes an existing receipt after reload", async ({
  page,
}) => {
  const hash = "0x" + "ab".repeat(32);
  await page.addInitScript(
    ({ hash }) => {
      localStorage.setItem(
        "disburse:pending-billing:demo",
        JSON.stringify({ hash, plan: "team" }),
      );
    },
    { hash },
  );
  await page.goto("/org/demo/settings?tab=billing");
  await page.getByRole("button", { name: "Renew for 30 days" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Payment transaction hash")).toHaveValue(hash);
  await expect(dialog).toContainText(
    "An earlier subscription payment needs verification",
  );
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Pay with connected wallet" }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "Renew for 30 days" }).click();
  await expect(page.getByLabel("Payment transaction hash")).toHaveValue(hash);
});

test("a confirmed reverted billing receipt releases checkout for another attempt", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("qa:scenario", "billing-reverted");
    localStorage.setItem(
      "disburse:pending-billing:demo",
      JSON.stringify({ hash: "0x" + "ab".repeat(32), plan: "team" }),
    );
  });
  await page.goto("/org/demo/settings?tab=billing");
  await page.getByRole("button", { name: "Renew for 30 days" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Verify payment", exact: true })
    .click();
  await expect(dialog).toContainText("No subscription payment was collected");
  await expect(
    dialog.getByRole("button", { name: "Pay with connected wallet" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("disburse:pending-billing:demo"),
    ),
  ).toBeNull();
  await page.screenshot({
    path: ".local/qa/story-billing-reverted.png",
    fullPage: true,
  });
});
