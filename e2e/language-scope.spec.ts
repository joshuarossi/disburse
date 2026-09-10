import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const es = JSON.parse(
  readFileSync(
    new URL("../src/locales/es/workspace.json", import.meta.url),
    "utf8",
  ),
);
const pt = JSON.parse(
  readFileSync(
    new URL("../src/locales/pt-BR/workspace.json", import.meta.url),
    "utf8",
  ),
);
const locales = [
  {
    language: "es",
    messages: es,
    headings: [
      "Panel",
      "Destinatarios",
      "Pagos",
      "Facturas por pagar",
      "Facturas emitidas",
      "Programaciones",
      "Cuentas",
      "Equipo y aprobaciones",
      "Configuración",
      "Informes",
    ],
  },
  {
    language: "pt-BR",
    messages: pt,
    headings: [
      "Painel",
      "Destinatários",
      "Pagamentos",
      "Contas a pagar",
      "Faturas emitidas",
      "Agendamentos",
      "Contas",
      "Equipe e aprovações",
      "Configurações",
      "Relatórios",
    ],
  },
];
const routes = [
  "dashboard",
  "beneficiaries",
  "disbursements",
  "invoices",
  "receivables",
  "payments",
  "treasury",
  "team",
  "settings",
  "reports",
];
async function locale(page: Page, language: string) {
  await page.addInitScript(
    (value) => localStorage.setItem("i18nextLng", value),
    language,
  );
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
}
for (const { language, messages, headings } of locales) {
  const text = (key: string, values: Record<string, string> = {}) =>
    Object.entries(values).reduce(
      (value, [name, replacement]) =>
        value.replaceAll("{{" + name + "}}", replacement),
      (messages as Record<string, string>)[key],
    );
  for (const mobile of [false, true]) {
    test(`${language} ${mobile ? "mobile dark" : "desktop light"} workspace pages and controls fit`, async ({
      page,
    }, testInfo) => {
      await locale(page, language);
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      );
      await page.addInitScript(
        (theme) => localStorage.setItem("theme", theme),
        mobile ? "dark" : "light",
      );
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const [index, route] of routes.entries()) {
        await page.goto(`/org/demo/${route}`);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          headings[index],
        );
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        if (route === "disbursements") {
          await expect(
            page.getByRole("tab", { name: text("Drafts"), exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole("tab", { name: text("Upcoming"), exact: true }),
          ).toBeVisible();
        }
        if (route === "receivables")
          await expect(
            page.getByText(text("Partially paid"), { exact: true }),
          ).toBeVisible();
        if (route === "reports") {
          if (mobile) {
            await expect(
              page
                .getByText(language === "es" ? "Salida" : "Saída", {
                  exact: true,
                })
                .filter({ visible: true })
                .first(),
            ).toBeVisible();
          } else {
            await expect(
              page.getByRole("columnheader", {
                name: language === "es" ? "Dirección" : "Direção",
                exact: true,
              }),
            ).toBeVisible();
          }
          await expect(page.getByText("Outflow", { exact: true })).toHaveCount(
            0,
          );
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const clipped = await page
          .locator("main button, main input, main select")
          .evaluateAll((elements) =>
            elements
              .filter((element) => {
                const box = element.getBoundingClientRect();
                const scroller = element.closest(
                  '.workspace-tabs, [class*="overflow-x-auto"], [class*="overflow-auto"]',
                );
                return (
                  box.width &&
                  box.height &&
                  !scroller &&
                  (box.left < -1 || box.right > innerWidth + 1)
                );
              })
              .map(
                (element) =>
                  element.getAttribute("aria-label") ||
                  element.textContent?.trim(),
              ),
          );
        expect(clipped, route).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(route + ".png"),
          fullPage: true,
        });
      }
      expect(errors).toEqual([]);
      await page
        .getByRole("button", { name: text("Reconciliation"), exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: text("Reconciliation") }),
      ).toBeVisible();
    });
  }
  test(`${language} payment review preserves each recipient's currency and exact amount`, async ({
    page,
  }) => {
    await locale(page, language);
    await page.goto("/org/demo/disbursements?new=1");
    const dialog = page.getByRole("dialog");
    for (const [name, amount] of [
      ["Maya Chen", "1.000001"],
      ["Arjun Patel", "2.000002"],
    ]) {
      await dialog
        .getByRole("checkbox", {
          name: text("Select {{value1}}", { value1: name }),
        })
        .check();
      await dialog
        .getByLabel(text("Amount for {{value1}}", { value1: name }), {
          exact: true,
        })
        .fill(amount);
    }
    await dialog.getByText(text("Payment defaults"), { exact: true }).click();
    await dialog
      .getByLabel(text("Payment currency"), { exact: true })
      .selectOption("USDT");
    await dialog
      .getByRole("button", { name: text("Continue to timing") })
      .click();
    await dialog
      .getByLabel(text("Payment name"))
      .fill("September payroll / Nómina");
    await dialog
      .getByRole("button", { name: text("Review payment"), exact: true })
      .click();
    await expect(
      dialog.getByRole("row").filter({ hasText: "Maya Chen" }),
    ).toContainText("1,000001 USDC");
    await expect(
      dialog.getByRole("row").filter({ hasText: "Arjun Patel" }),
    ).toContainText("2,000002 USDT");
    await dialog
      .getByRole("button", {
        name: text("Save {{value1}} payment drafts", { value1: "2" }),
      })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      language === "es" ? "solo lectura" : "somente leitura",
    );
  });
  test(`${language} settings switch persists across reload and public invoice errors can change language`, async ({
    page,
  }) => {
    await page.goto("/org/demo/settings");
    await page
      .getByRole("combobox", { name: "Language" })
      .selectOption(language);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      headings[8],
    );
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Idioma", exact: true }),
    ).toHaveValue(language);
    await page.goto("/pay/not-a-real-invoice");
    await expect(
      page.getByRole("heading", { name: text("Invoice not found") }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Idioma", exact: true })
      .selectOption("en");
    await expect(
      page.getByRole("heading", { name: "Invoice not found" }),
    ).toBeVisible();
  });
  test(`${language} bill and recipient dialogs keep localized accessible labels`, async ({
    page,
  }) => {
    await locale(page, language);
    await page.goto("/org/demo/invoices");
    await page
      .getByRole("button", { name: text("Add bill"), exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(
      text("Add a bill"),
    );
    await page.keyboard.press("Escape");
    await page.goto("/org/demo/beneficiaries");
    await page
      .getByRole("button", { name: text("Add recipient"), exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByLabel(text("Full name"), { exact: true }),
    ).toBeVisible();
  });
  test(`${language} keeps exported transaction records identical to English`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem("qa:scenario", "report-paged"),
    );
    await page.goto("/org/demo/reports");
    const csv = async (label: string) => {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: label, exact: true }).click();
      const chunks: Buffer[] = [];
      for await (const chunk of (await (await download).createReadStream())!)
        chunks.push(chunk);
      return Buffer.concat(chunks).toString("utf8");
    };
    const baseline = await csv("Export all matches");
    await page.evaluate(async (language) => {
      const path = "/src/lib/i18n.ts";
      await (
        await import(/* @vite-ignore */ path)
      ).default.changeLanguage(language);
    }, language);
    const translated = await csv(text("Export all matches"));
    expect(translated).toBe(baseline);
    expect(translated).toContain("1.000001");
    expect(translated).toContain("2026-09-06T00:00:00.000Z");
  });
}

test("a language update leaves a real unsaved payment draft intact", async ({
  page,
}) => {
  await page.goto("/org/demo/disbursements?new=1");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "Select Maya Chen" }).check();
  await dialog
    .getByLabel("Amount for Maya Chen", { exact: true })
    .fill("1500.000001");
  await dialog.getByRole("button", { name: "Continue to timing" }).click();
  await dialog.getByLabel("Payment name").fill("September contractor payroll");
  // Exercise the same shared language event used by an account preference update.
  await page.evaluate(async () => {
    const path = "/src/lib/i18n.ts";
    await (
      await import(/* @vite-ignore */ path)
    ).default.changeLanguage("pt-BR");
  });
  await expect(dialog.getByLabel(pt["Payment name"])).toHaveValue(
    "September contractor payroll",
  );
  await dialog
    .getByRole("button", { name: pt["Review payment"], exact: true })
    .click();
  await expect(
    dialog.getByRole("row").filter({ hasText: "Maya Chen" }),
  ).toContainText("1.500,000001 USDC");
  await expect(
    dialog.getByRole("button", { name: pt["Save payment draft"] }),
  ).toBeEnabled();
});
