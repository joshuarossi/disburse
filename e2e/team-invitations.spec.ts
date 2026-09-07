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
  ["dark", 390],
] as const) {
  test(`private invitation needs no wallet address and keeps failures reviewable in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await page.goto("/org/demo/team");
    await page
      .getByRole("button", { name: "Invite member", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("radio", { name: "Private invitation link", exact: true }),
    ).toBeChecked();
    await expect(
      dialog.getByLabel("Sign-in wallet", { exact: true }),
    ).toHaveCount(0);
    await dialog.getByLabel("Full name", { exact: true }).fill("Jordan Patel");
    await dialog
      .getByLabel("Work email", { exact: true })
      .fill("jordan@northstar.co");
    await dialog
      .getByLabel("Workspace role", { exact: true })
      .selectOption("initiator");
    expect(
      (
        await new AxeBuilder({ page })
          .include("dialog")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `.local/qa/team-invite-${theme}.png`,
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Create invitation link", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("read-only");
    await expect(dialog.getByLabel("Work email", { exact: true })).toHaveValue(
      "jordan@northstar.co",
    );
    await dialog
      .getByRole("radio", { name: "Use a known sign-in wallet", exact: true })
      .check();
    await expect(
      dialog.getByLabel("Sign-in wallet", { exact: true }),
    ).toBeVisible();
  });
  test(`invited person reviews role and exact sign-in identity in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await page.goto(`/invite#${"e".repeat(64)}`);
    await expect(
      page.getByRole("heading", { name: "Join Northstar Studio" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Accept invitation", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("checkbox", { name: /Use this wallet for my membership/ })
      .check();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: `.local/qa/team-accept-${theme}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("read-only");
  });
}
test("invitation delivery, bounce and revocation are distinct from membership", async ({
  page,
}) => {
  await page.goto("/org/demo/team?tab=invitations");
  const delivered = page.getByRole("article", {
    name: "Invitation for jordan@northstar.co",
  });
  await expect(delivered).toContainText("Awaiting acceptance");
  await expect(delivered).toContainText("Delivered to mail server");
  const bounced = page.getByRole("article", {
    name: "Invitation for taylor@northstar.co",
  });
  await expect(bounced).toContainText("Email bounced");
  await delivered.getByRole("button", { name: "Revoke invitation" }).click();
  await delivered.getByRole("button", { name: "Confirm revocation" }).click();
  await expect(page.getByRole("alert")).toContainText("read-only");
});
test("expired links disclose no invitee and a wallet restriction blocks the wrong sign-in identity", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("qa:scenario"))
      sessionStorage.setItem("qa:scenario", "invite-wrong-wallet");
  });
  await page.goto(`/invite#${"e".repeat(64)}`);
  await page
    .getByRole("checkbox", { name: /Use this wallet for my membership/ })
    .check();
  await expect(
    page.getByRole("button", { name: "Accept invitation", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    sessionStorage.setItem("qa:scenario", "invite-expired"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Invitation unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("northstar.co");
});
test('creating an invitation offers a private link and email draft, with a usable clipboard-denied fallback', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('qa:scenario', 'invite-share');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } } });
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/org/demo/team');
  await page.getByRole('button', { name: 'Invite member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name', { exact: true }).fill('Jordan Patel');
  await dialog.getByLabel('Work email', { exact: true }).fill('jordan@example.invalid');
  await dialog.getByRole('button', { name: 'Create invitation link', exact: true }).click();
  await expect(dialog.getByLabel('Private invitation link', { exact: true })).toHaveValue(/\/invite#[e]{64}$/);
  await expect(dialog.getByRole('link', { name: 'Open email draft' })).toHaveAttribute('href', /^mailto:jordan%40example\.invalid\?subject=/);
  await expect(dialog).toContainText('Disburse has not sent an email');
  await dialog.getByRole('button', { name: 'Copy invitation link', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Select the link above and copy it');
  await expect(dialog).not.toContainText('NotAllowedError');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('private-invitation-clipboard-denied.png'), fullPage: true });
});
