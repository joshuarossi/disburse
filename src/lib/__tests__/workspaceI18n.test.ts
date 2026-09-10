import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
} from "@testing-library/react";
import { useState } from "react";
import { createElement } from "react";
import i18n from "../i18n";
import { tx, useWorkspaceLanguage } from "../workspaceI18n";
import {
  formatAssetAmount,
  formatDate,
  formatMoney,
  scheduleDateTime,
} from "../formatMoney";
import { amountToBaseUnits } from "../../../shared/validation";
import { payoutInstructionError } from "../../../shared/payoutInstructions";
import { invoiceReminder } from "../../../shared/receivables";
import { userErrorMessage } from "../userErrors";
import { WALLET_CANCELLED_MESSAGE } from "../walletErrors";
import en from "../../locales/en/workspace.json";
import es from "../../locales/es/workspace.json";
import pt from "../../locales/pt-BR/workspace.json";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

describe("workspace messages", () => {
  it.each([
    ["es", es],
    ["pt-BR", pt],
  ])(
    "%s has every message and preserves all interpolated values",
    (_language, catalog) => {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort());
      const variables = (value: string) =>
        [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
      for (const [key, value] of Object.entries(en)) {
        const translated = (catalog as Record<string, string>)[key];
        expect(translated.trim(), key).not.toBe("");
        expect(variables(translated), key).toEqual(variables(value));
        expect(translated, key).not.toMatch(
          /&nbsp;|function createProxyWithNonce/,
        );
      }
    },
  );

  it.each(["es", "pt-BR"])(
    "%s translates full plural phrases and shared validation without changing recipient data",
    async (language) => {
      await i18n.changeLanguage(language);
      expect(tx("{{count}} account approvals", { count: 1 })).toBe(
        language === "es" ? "1 aprobación de cuenta" : "1 aprovação da conta",
      );
      expect(tx("{{count}} account approvals", { count: 2 })).toBe(
        language === "es"
          ? "2 aprobaciones de cuenta"
          : "2 aprovações da conta",
      );
      const recipient = { name: "Maya <Chen> & Sons", preferredToken: "USDC" };
      const error = payoutInstructionError(recipient, {
        token: "USDT",
        chainId: 8453,
      })!;
      const translated = tx(error);
      expect(translated).toContain(recipient.name);
      expect(translated).toContain(
        language === "es"
          ? "solicita USDC. Este pago usa USDT."
          : "solicita USDC. Este pagamento usa USDT.",
      );
      expect(recipient.preferredToken).toBe("USDC");
    },
  );

  it("uses the flow-specific recovery message for unknown server wording", async () => {
    await i18n.changeLanguage("es");
    const fallback =
      "The saved fee request could not be read. Check its status before creating another.";
    expect(
      userErrorMessage(new Error("Unknown upstream failure"), fallback),
    ).toBe(tx(fallback));
    expect(
      userErrorMessage(
        new Error("Invoice number already exists. Choose another number."),
        fallback,
      ),
    ).toBe("El número de factura ya existe. Elige otro número.");
  });

  it.each(["es", "pt-BR"])(
    "%s translates the shared wallet cancellation message",
    async (language) => {
      await i18n.changeLanguage(language);
      expect(tx(WALLET_CANCELLED_MESSAGE)).toBe(
        language === "es"
          ? "Se canceló la confirmación en la billetera. Puedes volver a intentarlo cuando quieras."
          : "A confirmação na carteira foi cancelada. Você pode tentar novamente quando quiser.",
      );
    },
  );

  it("keeps customer invoice fields and links intact in translated reminder drafts", async () => {
    const draft = invoiceReminder(
      {
        number: "INV-ES-001",
        customerName: "Maya & Co",
        token: "USDC",
        dueDate: Date.UTC(2026, 8, 15),
        publicToken: "private-test",
        state: "issued",
        amount: "100.000001",
        received: "0",
        forwarded: "0",
      },
      "https://example.test",
    );
    await i18n.changeLanguage("pt-BR");
    expect(tx(draft.subject)).toBe("Lembrete de pagamento: fatura INV-ES-001");
    expect(tx(draft.body)).toContain("saldo pendente de 100.000001 USDC");
    expect(tx(draft.body)).toContain("https://example.test/pay/private-test");
    expect(tx(draft.body)).toContain("Maya & Co");
  });
});

describe("localized accounting presentation", () => {
  it.each(["es", "pt-BR"])(
    "%s preserves exact financial precision and UTC while localizing display",
    async (language) => {
      await i18n.changeLanguage(language);
      expect(formatMoney("9007199254740993.000001", "USDC", true)).toBe(
        "$9.007.199.254.740.993,000001",
      );
      expect(formatAssetAmount("0.030000000000000001", "ETH")).toBe(
        "0,030000000000000001",
      );
      expect(amountToBaseUnits("1.000001", "USDC")).toBe(1000001n);
      const at = Date.UTC(2026, 8, 15, 0, 1);
      expect(formatDate(at)).toContain("15");
      expect(scheduleDateTime(at)).toContain("UTC");
      expect(scheduleDateTime(at)).toMatch(/0{1,2}:01/);
    },
  );

  it("re-renders authored labels without resetting an in-progress field", async () => {
    function Draft() {
      useWorkspaceLanguage();
      const [amount, setAmount] = useState("");
      return createElement(
        "label",
        null,
        tx("Amount"),
        createElement("input", {
          value: amount,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
            setAmount(event.target.value),
        }),
      );
    }
    render(createElement(Draft));
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "1500.000001" },
    });
    await act(() => i18n.changeLanguage("pt-BR"));
    expect(screen.getByLabelText("Valor")).toHaveValue("1500.000001");
  });
});
