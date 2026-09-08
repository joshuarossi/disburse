import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const theme of ["light", "dark"]) {
  for (const [route, action] of [
    ["beneficiaries", "Maya Chen"],
    ["invoices", "View details"],
    ["disbursements", /^Review /],
    ["receivables", "INV-2026-1042"],
    ["payments", /^Review schedule /],
    ["team", /^View access for /],
  ] as const) {
    test(`${theme} mobile ${route}: record values and review actions fit without sideways scrolling`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      await page.route("**/*", (route) =>
        ["localhost", "127.0.0.1"].includes(
          new URL(route.request().url()).hostname,
        )
          ? route.continue()
          : route.abort(),
      );
      await page.goto(`/org/demo/${route}`);
      const table = page.getByRole("table");
      const row = table.locator("tbody").getByRole("row").first();
      await expect(row).toBeVisible();
      // Browser visibility alone allows off-screen cells inside a scrollable table.
      const cells = await row.getByRole("cell").evaluateAll((elements) =>
        elements
          .filter(
            (element) =>
              element.textContent?.trim() || element.querySelector("input"),
          )
          .map((element) => {
            const box = element.getBoundingClientRect();
            return {
              left: box.left,
              right: box.right,
              width: box.width,
              viewport: innerWidth,
            };
          }),
      );
      expect(cells.length).toBeGreaterThan(2);
      for (const cell of cells) {
        expect(cell.left).toBeGreaterThanOrEqual(0);
        expect(cell.right).toBeLessThanOrEqual(cell.viewport);
        expect(cell.width).toBeGreaterThan(0);
      }
      const button = row
        .getByRole("button", {
          name: action,
          exact: typeof action === "string",
        })
        .first();
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      if (route === "beneficiaries" || route === "invoices") {
        const checkbox = row.getByRole("checkbox");
        await checkbox.check();
        await expect(checkbox).toBeChecked();
        await checkbox.uncheck();
      }
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await button.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}
