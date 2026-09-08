import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

test("S14 selected recipient stays readable beside an exact amount on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/org/demo/disbursements?new=1");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "Select Maya Chen" }).check();
  const amount = dialog.getByLabel("Amount for Maya Chen", { exact: true });
  await amount.fill("1.000001");
  const name = dialog.getByText("Maya Chen", { exact: true });
  expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  const nameBox = await name.boundingBox(),
    amountBox = await amount.boundingBox();
  expect(amountBox!.y).toBeGreaterThan(nameBox!.y + nameBox!.height);
  await dialog.getByRole("button", { name: "Continue to timing" }).click();
  await dialog.getByLabel("Payment name").fill("Mobile payout");
  await dialog
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(
    dialog.getByRole("list", { name: "Recipient payout review" }),
  ).toContainText("1.000001 USDC");
  await expect(
    dialog.getByRole("button", { name: "Save payment draft" }),
  ).toBeVisible();
});

test("S10 choosing an account carries its network into the payment form", async ({
  page,
}) => {
  await page.goto("/org/demo/disbursements?new=1&chain=11155111");
  await page
    .getByRole("dialog")
    .getByText("Payment defaults", { exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Default payment network"),
  ).toHaveValue("11155111");
  await expect(
    page.getByRole("dialog").getByLabel("Default payment network"),
  ).toContainText("No linked funding account");
});

test("S02 saved USDC instructions cannot be replaced by changing a payment default", async ({
  page,
}) => {
  await page.goto("/org/demo/disbursements?new=1");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("checkbox", { name: /Use saved payout instructions/ }),
  ).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "Select Maya Chen" }).check();
  await dialog
    .getByLabel("Amount for Maya Chen", { exact: true })
    .fill("1.000001");
  await dialog.getByText("Payment defaults", { exact: true }).click();
  await dialog
    .getByLabel("Payment currency", { exact: true })
    .selectOption("USDT");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Continue to timing" }).click();
  await expect(dialog.getByLabel("Payment name")).toHaveValue(
    "Maya Chen payment",
  );
  await dialog
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(
    dialog.getByRole("row").filter({ hasText: "Maya Chen" }),
  ).toContainText("1.000001 USDC");
  await expect(
    dialog.getByRole("row").filter({ hasText: "Maya Chen" }),
  ).not.toContainText("USDT");
  await expect(
    dialog.getByRole("button", { name: "Save payment draft" }),
  ).toBeEnabled();
});

test("S03 mixed payment review checks the combined principal and both fees against one account", async ({
  page,
}) => {
  await page.goto("/org/demo/disbursements?new=1");
  const dialog = page.getByRole("dialog");
  for (const [name, amount] of [
    ["Maya Chen", "1.000001"],
    ["Arjun Patel", "2.000002"],
  ]) {
    await dialog.getByRole("checkbox", { name: `Select ${name}` }).check();
    await dialog.getByLabel(`Amount for ${name}`, { exact: true }).fill(amount);
  }
  const funding = dialog.getByRole("region", { name: "Base funding check" });
  await expect(funding).toHaveCount(1);
  await expect(funding).toContainText("1.100001 USDC");
  await expect(funding).toContainText("2.000002 USDT");
  await expect(funding).toContainText("2 of 2 owners required");
  await expect(funding).toContainText("Alex Morgan · Jordan Lee");
});

test("S14 Payments has exactly one primary New payment action", async ({
  page,
}) => {
  await page.goto("/org/demo/disbursements");
  await expect(
    page.getByRole("button", { name: "New payment", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "New payment", exact: true }),
  ).toHaveCount(0);
});

test("S03 saved payout instructions prepare mixed currencies as separate reviewed batches", async ({
  page,
}) => {
  await page.goto("/org/demo/disbursements?new=1");
  const dialog = page.getByRole("dialog");
  for (const [name, amount] of [
    ["Maya Chen", "1.000001"],
    ["Arjun Patel", "2.000002"],
  ]) {
    await dialog.getByRole("checkbox", { name: `Select ${name}` }).check();
    await dialog.getByLabel(`Amount for ${name}`, { exact: true }).fill(amount);
  }
  // Changing the fallback currency never changes saved instructions.
  await dialog.getByText("Payment defaults", { exact: true }).click();
  await dialog
    .getByLabel("Payment currency", { exact: true })
    .selectOption("USDT");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Continue to timing" }).click();
  await dialog.getByLabel("Payment name").fill("Mixed payroll");
  await dialog
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(
    dialog.getByRole("row").filter({ hasText: "Maya Chen" }),
  ).toContainText("1.000001 USDC");
  await expect(
    dialog.getByRole("row").filter({ hasText: "Arjun Patel" }),
  ).toContainText("2.000002 USDT");
  await expect(dialog).toContainText("2 separately approved batches");
  await expect(
    dialog.getByRole("button", { name: "Save 2 payment drafts" }),
  ).toBeEnabled();
});

test("S06 review shows individual approvals and cannot send a partially approved payment", async ({
  page,
}) => {
  await page.goto("/org/demo/disbursements?focus=p2");
  const dialog = page.getByRole("dialog");
  const approvals = dialog.getByRole("region", { name: "Payment approvals" });
  await expect(approvals).toContainText("1 of 2 required approvals received");
  await expect(approvals).toContainText("Awaiting approval");
  await expect(
    dialog.getByRole("button", { name: "Send payment" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Approve", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: ".local/qa/story-payment-approvals.png",
    fullPage: true,
  });
});

test("S01 maps unfamiliar employee columns without dropping payout instructions", async ({
  page,
}) => {
  await page.goto("/org/demo/beneficiaries?import=1");
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=file]").setInputFiles({
    name: "employees.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Display,Contact,Coin,Route\nJamie,jamie@example.com,USDT,Base",
    ),
  });
  await expect(dialog.getByRole("alert")).toContainText(
    "Missing required column",
  );
  for (const [column, value] of [
    ["1: Display", "name"],
    ["2: Contact", "email"],
    ["3: Coin", "preferred_token"],
    ["4: Route", "preferred_network"],
  ])
    await dialog.getByLabel(`Map column ${column}`).selectOption(value);
  await dialog.getByRole("button", { name: "Apply column mapping" }).click();
  const row = dialog.getByRole("row").filter({ hasText: "Jamie" });
  await expect(row).toContainText("jamie@example.com");
  await expect(row).toContainText("USDT");
  await expect(row).toContainText("Base");
  await expect(row).toContainText("Payment details needed");
  await page.screenshot({
    path: ".local/qa/story-import-mapping.png",
    fullPage: true,
  });
});

test("S09 policy changes show reviewable authority and cannot execute without approvals", async ({
  page,
}) => {
  await page.goto("/org/demo/team");
  await page.getByRole("tab", { name: "Delegated spending" }).click();
  const queue = page.getByRole("region", { name: "Policy approvals" });
  await expect(queue).toContainText("Set allowance · Jordan Lee");
  await expect(queue).toContainText("1 of 2 approvals");
  await expect(
    queue.getByRole("button", { name: "Apply policy" }),
  ).toBeDisabled();
  await queue.getByRole("checkbox").check();
  await expect(
    queue.getByRole("button", { name: "Approve policy" }),
  ).toBeEnabled();
  await queue.getByRole("button", { name: "Approve policy" }).click();
  await expect(queue.getByRole("alert")).toContainText("read-only");
  await page.screenshot({
    path: ".local/qa/story-policy-desktop.png",
    fullPage: true,
  });
});

test("S09 a single-recipient draft reviews an allowance without a reusable recipient signature", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "circle-delegated-single"),
  );
  await page.goto("/org/demo/disbursements?focus=p1");
  const dialog = page.getByRole("dialog");
  await dialog
    .getByText("Pay with a spending allowance", { exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Check my allowance", exact: true })
    .click();
  await expect(dialog).toContainText("Available allowance: 25000 USDC");
  await expect(
    dialog.getByRole("button", {
      name: "Review fee and approval",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Review in wallet", exact: true }),
  ).toHaveCount(0);
  await expect(dialog).toContainText("Member spending allowance");
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBeNull();
});

test("S14 mobile overview shows complete amounts, statuses and one create action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/org/demo/dashboard");
  const cards = page.getByTestId("overview-payment-cards");
  await expect(cards).toBeVisible();
  await expect(cards.getByText("$4,800.00", { exact: false })).toBeVisible();
  await expect(
    cards.getByText("Awaiting signatures", { exact: true }),
  ).toBeVisible();
  expect(await cards.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await expect(
    page.getByRole("link", { name: "New payment", exact: true }),
  ).toHaveCount(1);
  await cards
    .getByRole("link", { name: "Review Product studio · September" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("delegated batches use one account approval for every saved recipient", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "circle-delegated-batch"),
  );
  await page.goto("/org/demo/disbursements?focus=p1");
  const dialog = page.getByRole("dialog");
  await dialog
    .getByText("Pay with a spending allowance", { exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Check my allowance", exact: true })
    .click();
  await expect(dialog).toContainText(
    "authorize every saved recipient together",
  );
  await expect(dialog).toContainText("Review the USDC gas fee before signing");
  await expect(dialog).toContainText("Maya Chen");
  await expect(dialog).toContainText("James Okafor");
  await expect(
    dialog.getByRole("combobox", { name: "Execution fee" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("qa:circle-signatures")),
  ).toBeNull();
});

test("the delegate reviews a separate USDC execution fee without changing recipient amounts", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "circle-delegated-batch"),
  );
  await page.goto("/org/demo/disbursements?focus=p1");
  const dialog = page.getByRole("dialog");
  await dialog
    .getByText("Pay with a spending allowance", { exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Check my allowance", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Review fee and approval", exact: true })
    .click();
  const fees = dialog.getByRole("region", { name: "Execution fees" });
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  await expect(fees).toContainText("0.5 USDC");
  await expect(dialog).toContainText(
    "Recipient amounts and the original allowance authorization stay unchanged",
  );
  await expect(dialog).toContainText("Maya Chen");
  await expect(dialog).toContainText("James Okafor");
});
