import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Keep this browser suite offline except for the local QA server.
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

for (const [route, title] of [
  ["dashboard", "Overview"],
  ["beneficiaries", "Recipients"],
  ["disbursements", "Payments"],
  ["invoices", "Bills"],
  ["payments", "Schedules"],
  ["treasury", "Accounts"],
  ["team", "Team & approvals"],
  ["settings", "Settings"],
  ["reports", "Reports"],
]) {
  test(`${title} renders the actual workspace`, async ({ page }) => {
    await page.goto(`/org/demo/${route}`);
    await expect(
      page.getByRole("heading", { name: title, exact: true, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Preview · sample data · read-only"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "This page could not load" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("status", { name: "Loading records" }),
    ).toHaveCount(0);
  });
}

test("screening settings load and reject changes in the read-only preview", async ({
  page,
}) => {
  await page.goto("/org/demo/settings");
  await page.getByRole("tab", { name: "Screening", exact: true }).click();
  const options = page.getByRole("radio");
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toBeChecked();
  await options.nth(1).click();
  await expect(page.getByRole("alert")).toContainText("read-only");
  await expect(options.nth(0)).toBeChecked();
  await expect(options.nth(1)).toBeEnabled();
  await page.reload();
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toBeChecked();
});

test("recipient search and missing-detail filter", async ({ page }) => {
  await page.goto("/org/demo/beneficiaries");
  await page.getByRole("tab", { name: "Details needed" }).click();
  await expect(page.getByText("Sofia Garcia", { exact: true })).toBeVisible();
  await expect(page.getByText("Maya Chen", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "All recipients" }).click();
  await page
    .getByRole("textbox", { name: "Search name, email, or group" })
    .fill("Maya");
  await expect(page.getByText("Maya Chen", { exact: true })).toBeVisible();
  await expect(page.getByText("James Okafor", { exact: true })).toHaveCount(0);
});

test("payment builder reviews an immediate batch without a write", async ({
  page,
}) => {
  await page.goto("/org/demo/disbursements?new=1");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Select Maya Chen" }).check();
  await dialog
    .getByRole("textbox", { name: "Amount for Maya Chen", exact: true })
    .fill("1500.000001");
  await dialog.getByRole("button", { name: "Continue to timing" }).click();
  await dialog.getByLabel("Payment name").fill("September contractor payout");
  await expect(dialog.getByLabel("When to pay")).toHaveValue("now");
  await dialog
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(
    dialog.getByText("As soon as approved", { exact: false }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("row").filter({ hasText: "Maya Chen" }).getByText("$1,500.000001 USDC", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Save payment draft" }).click();
  await expect(dialog.getByRole("alert")).toContainText("read-only");
});

test("bill review defaults to payment after approval", async ({ page }) => {
  await page.goto("/org/demo/invoices");
  await page
    .getByRole("checkbox", { name: "Select invoice INV-2026-084", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("When to pay")).toHaveValue("now");
  await expect(dialog.getByText("Studio North", { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Prepare payment", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("read-only");
});

test("team separates app limits and contract allowances", async ({ page }) => {
  await page.goto("/org/demo/team");
  await page.getByRole("tab", { name: "Delegated spending" }).click();
  await expect(page.getByText("$20,500.00 USDC", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Set allowance", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("mobile workspace fits the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/org/demo/dashboard");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /Open navigation/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Recipients", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recipients", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("employee CSV import previews identities without inventing payment details", async ({
  page,
}) => {
  await page.goto("/org/demo/beneficiaries?import=1");
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=file]").setInputFiles({
    name: "employees.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "First Name,Last Name,Work Email\nJamie,Rivera,jamie@example.com\nTaylor,Wilson,taylor@example.com\n",
    ),
  });
  await expect(dialog.getByText("Jamie Rivera", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("Taylor Wilson", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Payment details needed", { exact: true }),
  ).toHaveCount(2);
  await expect(
    dialog.getByText(/Recipients without payment details/),
  ).toBeVisible();
});

test("recurring edit changes future instructions and preserves a review step", async ({
  page,
}) => {
  await page.goto("/org/demo/payments");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Schedule name")).toHaveValue(
    "Contractor payroll",
  );
  await dialog.getByLabel("Frequency").selectOption("biweekly");
  await dialog
    .getByRole("textbox", { name: "Amount for recipient 1" })
    .fill("16000");
  await dialog.getByRole("button", { name: "Save schedule" }).click();
  await expect(dialog.getByRole("alert")).toContainText("read-only");
});

test("an unsigned payment opens with editable saved values", async ({
  page,
}) => {
  await page.goto("/org/demo/disbursements?focus=p1");
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("textbox", { name: "Amount for Maya Chen", exact: true }),
  ).toHaveValue("14225");
  await expect(
    dialog.getByText(/Existing recipients keep their saved payout addresses/),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Continue to timing" }).click();
  await expect(dialog.getByLabel("Payment name")).toHaveValue("September contractor payroll");
});

test("dark appearance persists across workspace navigation", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/org/demo/dashboard");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Recipients", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recipients", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

for (const route of [
  "disbursements",
  "invoices",
  "payments",
  "team",
  "settings",
  "treasury",
  "reports",
]) {
  test(`${route} keeps mobile scrolling within its tables`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/org/demo/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("spending CSV preserves six decimals beyond floating point precision", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "precision"),
  );
  await page.goto("/org/demo/reports");
  await page
    .getByRole("navigation", { name: "Report sections" })
    .getByRole("button", { name: /Spending/ })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export/ }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString("utf8")).toContain(
    "9007199254.740993",
  );
});

for (const route of [
  "beneficiaries",
  "disbursements",
  "invoices",
  "payments",
  "reports",
]) {
  test(`${route} handles an empty workspace`, async ({ page }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem("qa:scenario", "empty"),
    );
    await page.goto(`/org/demo/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "This page could not load" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("status", { name: "Loading records" }),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("NaN");
  });
}

for (const tab of [
  "General",
  "Funding accounts",
  "Payment fees",
  "Screening",
  "Plan & billing",
]) {
  test(`settings section ${tab} renders controls`, async ({ page }) => {
    await page.goto("/org/demo/settings");
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(
      page.locator(".workspace-settings-sections"),
    ).not.toContainText("Loading...");
    await expect(
      page.locator(".workspace-settings-sections .animate-spin"),
    ).toHaveCount(0);
    await expect(
      page.locator(".workspace-settings-sections").getByRole("heading").first(),
    ).toBeVisible();
  });
}

test("header theme toggle works and persists after reload on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    if (!localStorage.getItem("theme")) localStorage.setItem("theme", "light");
  });
  await page.goto("/org/demo/dashboard");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("current plan can renew and unconfigured checkout cannot send funds", async ({
  page,
}) => {
  await page.goto("/org/demo/settings?tab=billing");
  await page.getByRole("button", { name: "Renew for 30 days" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("checkout is unavailable");
  await expect(
    dialog.getByRole("button", { name: "Pay with Connected Wallet" }),
  ).toHaveCount(0);
});

test("expired subscription returns to Free without blocking core payments", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("qa:scenario", "expired"));
  await page.goto("/org/demo/dashboard");
  await expect(page.getByText("Subscription ended", { exact: true })).toHaveCount(0);
  await page.goto("/org/demo/settings?tab=billing");
  await expect(page.getByText("No subscription charge", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose plan" }).first()).toBeEnabled();
  await expect(page.getByText("0 days remaining", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Core money management and payments remain available", { exact: false })).toBeVisible();
});

test('execution fees require review without changing the approved recipient amounts', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'circle-success'));
  await page.goto('/org/demo/disbursements?focus=p1');
  const dialog = page.getByRole('dialog');
  const recipients = await dialog.getByRole('table').innerText();
  await dialog.getByRole('button', { name: 'Review execution fee', exact: true }).click();
  const approve = dialog.getByRole('button', { name: 'Approve fee limit', exact: true });
  await expect(approve).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /I approve up to 0.5 USDC/ }).check();
  await expect(approve).toBeEnabled();
  expect(await dialog.getByRole('table').innerText()).toBe(recipients);
  await dialog.getByRole('checkbox', { name: /I approve up to 0.5 USDC/ }).uncheck();
  await expect(approve).toBeDisabled();
});

test('payment review shows the fee-inclusive debit and safe recovery action', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'recovery'));
  await page.goto('/org/demo/disbursements?focus=p1');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Total account debit')).toBeVisible();
  await expect(dialog.getByText('$28,450.05 USDC', { exact: true })).toBeVisible();
  const recovery = dialog.getByRole('region', { name: 'Payment recovery' });
  await expect(recovery.getByText('Payment needs attention')).toBeVisible();
  await recovery.getByRole('button', { name: 'Check settlement' }).click();
  await expect(recovery.getByRole('status')).toContainText('read-only');
  await page.screenshot({ path: '.local/qa/story-payment-recovery.png', fullPage: true });
});

test('unresolved submissions are visible in the attention queue', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'recovery'));
  await page.goto('/org/demo/disbursements?view=attention');
  await expect(page.getByRole('tab', { name: 'Needs attention', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('September contractor payroll', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/qa/story-attention-queue.png', fullPage: true });
  await page.getByText('September contractor payroll', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Payment recovery' })).toBeVisible();
});

test('a never-submitted payment offers resume rather than settlement checking', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'preparation'));
  await page.goto('/org/demo/disbursements?focus=p1');
  const recovery = page.getByRole('region', { name: 'Payment recovery' });
  await expect(recovery).toContainText('No submission was attempted');
  await expect(recovery.getByRole('button', { name: 'Check settlement' })).toHaveCount(0);
  await recovery.getByRole('button', { name: 'Resume payment' }).click();
  await expect(recovery.getByRole('status')).toContainText('read-only');
});

test('editing a draft retains its saved payout address after the directory changes', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('qa:scenario', 'changed-directory'));
  await page.goto('/org/demo/disbursements?focus=p1');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Edit draft' }).click();
  await dialog.getByRole('button', { name: 'Continue to timing' }).click();
  await dialog.getByRole('button', { name: 'Review payment', exact: true }).click();
  const recipient = dialog.getByRole('row').filter({ hasText: 'Maya Chen' });
  await expect(recipient.locator('[title="0x5555555555555555555555555555555555555555"]')).toBeVisible();
  await expect(dialog.locator('[title="0x9999999999999999999999999999999999999999"]')).toHaveCount(0);
  await page.screenshot({ path: '.local/qa/story-draft-address-snapshot.png', fullPage: true });
});
