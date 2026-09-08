import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const theme of ["light", "dark"]) {
  test(`${theme} invoice collection makes customer-paid fees explicit`, async ({
    page,
  }) => {
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await page.setViewportSize(
      theme === "dark"
        ? { width: 430, height: 1000 }
        : { width: 1440, height: 1000 },
    );
    await page.goto("/org/demo/receivables");
    await page
      .getByRole("button", { name: "INV-2026-1042", exact: true })
      .click();
    const section = page.getByRole("region", { name: "Invoice collection" });
    await section.scrollIntoViewIfNeeded();
    await expect(section).toContainText("Your company account pays the execution service directly");
    await expect(section).toContainText("full invoice balance moves into your company account");
    await expect(
      section.getByRole("button", { name: "Review execution fee", exact: true }),
    ).toBeEnabled();
    await expect(section.getByRole("button")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `.local/qa/story-collection-customer-fees-${theme}.png`,
    });
  });
}

test("a viewer can inspect collection fees without sending a wallet transaction", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("qa:scenario", "ar-viewer"),
  );
  await page.goto("/org/demo/receivables");
  await page
    .getByRole("button", { name: "INV-2026-1042", exact: true })
    .click();
  const section = page.getByRole("region", { name: "Invoice collection" });
  await expect(section).toContainText("Your company account pays the execution service directly");
  await expect(section.getByRole("button", { name: "Review execution fee" })).toBeDisabled();
});
