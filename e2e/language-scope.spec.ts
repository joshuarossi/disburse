import { expect, test } from "@playwright/test";

for (const [language, title, fees] of [
  ["es", "Paga a tu equipo.", "Comisiones en el mismo proceso"],
  ["pt-BR", "Pague sua equipe.", "Taxas no mesmo processo"],
]) {
  test(`${language} public copy retains its preference when opening the English finance workspace`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("i18nextLng", value),
      language,
    );
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
    await expect(page.getByText(fees, { exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await page.goto("/org/demo/invoices");
    await expect(
      page.getByRole("heading", { name: "Bills", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add bill", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName("Add a bill");
    await expect(
      page.getByRole("dialog").locator("xpath=ancestor::*[@lang][1]"),
    ).toHaveAttribute("lang", "en");
    expect(await page.evaluate(() => localStorage.getItem("i18nextLng"))).toBe(
      language,
    );
    await page.goto("/org/demo/settings");
    await expect(
      page.getByText("Workspace language", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "English", exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("i18nextLng"))).toBe(
      language,
    );
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
  });
}
