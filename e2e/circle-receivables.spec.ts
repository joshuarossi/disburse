import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function start(
  page: Page,
  kind: "factory" | "collection",
  scenario: string,
) {
  await page.addInitScript((value) => {
    localStorage.setItem("theme", "dark");
    sessionStorage.setItem("qa:scenario", value);
  }, `circle-${kind}-${scenario}`);
  await page.goto("/org/demo/receivables");
  await page
    .getByRole("button", {
      name: kind === "factory" ? "INV-2026-1043" : "INV-2026-1042",
      exact: true,
    })
    .click();
  const fees = page.getByRole("region", { name: "Execution fees" });
  await fees
    .getByRole("button", { name: "Review execution fee", exact: true })
    .click();
  return fees;
}
for (const kind of ["factory", "collection"] as const) {
  test(`${kind}: a cancelled confirmation keeps invoice funds and shows a neutral notice`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fees = await start(page, kind, "declined");
    await fees.getByRole("checkbox").check();
    await fees
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await expect(fees.getByRole("status")).toContainText(
      "Wallet confirmation cancelled",
    );
    await expect(fees.getByRole("alert")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("qa:circle-submissions"),
      ),
    ).toBeNull();
    await expect(
      page.getByRole("button", { name: "Collect with wallet" }),
    ).toHaveCount(0);
    if (kind === "factory")
      await expect(
        page.getByRole("button", { name: "Generate payment link" }),
      ).toBeDisabled();
    expect(await fees.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await fees.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`${kind}-declined-mobile.png`),
      fullPage: true,
    });
  });
  test(`${kind}: an interrupted submission survives reload without another charge`, async ({
    page,
  }) => {
    const fees = await start(page, kind, "unknown");
    await fees.getByRole("checkbox").check();
    await fees
      .getByRole("button", { name: "Approve fee limit", exact: true })
      .click();
    await fees
      .getByRole("button", { name: "Approve execution", exact: true })
      .click();
    const label =
      kind === "factory" ? "Set up receiving" : "Collect invoice funds";
    await fees.getByRole("button", { name: label, exact: true }).click();
    await expect(fees.getByRole("alert")).toContainText(
      "original execution request is saved",
    );
    await page.reload();
    await page
      .getByRole("button", {
        name: kind === "factory" ? "INV-2026-1043" : "INV-2026-1042",
        exact: true,
      })
      .click();
    await expect(
      fees.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
    await expect(
      fees.getByRole("button", { name: "Review execution fee", exact: true }),
    ).toHaveCount(0);
    await expect(
      fees.getByRole("button", { name: "Check execution status", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("qa:circle-submissions"),
      ),
    ).toBe("1");
  });
}
test("a receiving network outage keeps issuance disabled and offers another check", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "receiving-status-outage"),
  );
  await page.goto("/org/demo/receivables");
  await page
    .getByRole("button", { name: "INV-2026-1043", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check again", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate payment link" }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).not.toContainText(
    "https://reader.invalid",
  );
});
