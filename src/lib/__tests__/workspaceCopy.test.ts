import { expect, it } from "vitest";
import ts from "typescript";
import en from "../../locales/en/workspace.json";
import es from "../../locales/es/workspace.json";
import pt from "../../locales/pt-BR/workspace.json";
import legacyEn from "../../locales/en/translation.json";
import legacyEs from "../../locales/es/translation.json";
import legacyPt from "../../locales/pt-BR/translation.json";
const sources = import.meta.glob(
  ["/src/**/*.tsx", "!/src/dev/**", "!/src/**/__tests__/**"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;
const identities = new Set([
  " · Alias",
  "· UTC",
  "(UTC)",
  "0x...",
  "0x…",
  "Aave ·",
  "Circle CCTP",
  "d",
  "Deel",
  "disburse",
  "Disburse",
  "Est. ",
  "First name\tLast name\tEmail\nJamie\tChen\tjamie@example.com",
  "General",
  "Gusto",
  "INV-1001",
  "INV-1042",
  "Item",
  "KB",
  "KB ·",
  "Plan",
  "QuickBooks",
  "Rippling",
  "s",
  "T",
  "Total",
  "Uniswap ·",
  "USDC",
  "USDT",
  "UTC",
  "Xero",
  "Safe",
  "Pro",
  "Email",
  "Error",
  "Status",
  "WalletConnect",
  "MetaMask",
  "Admin",
  "Blog",
  "Docs",
  "Subtotal",
  "Legal",
  "Design",
  "control",
]);
it("requires reviewed translations for authored workspace text and accessible labels", () => {
  const missing: string[] = [];
  const copyAttributes = new Set([
    "title",
    "label",
    "description",
    "detail",
    "placeholder",
    "aria-label",
    "aria-description",
    "data-label",
    "reviewText",
    "refreshLabel",
  ]);
  for (const [file, source] of Object.entries(sources)) {
    if (!source.includes("workspaceI18n")) continue;
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node: ts.Node) {
      const displayAttribute =
        ts.isJsxAttribute(node) &&
        (copyAttributes.has(node.name.getText(ast)) ||
          (node.name.getText(ast) === "value" &&
            node.parent.parent.tagName.getText(ast) === "Metric"));
      const raw = ts.isJsxText(node)
        ? node.text.trim()
        : displayAttribute &&
            node.initializer &&
            ts.isStringLiteral(node.initializer)
          ? node.initializer.text
          : "";
      if (
        /[A-Za-z]{2}/.test(raw) &&
        !identities.has(raw) &&
        !/^0x|^[A-Z]+-\d+$/.test(raw)
      )
        missing.push(`${file}: ${raw}`);
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(ast) === "tx" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const key = node.arguments[0].text;
        if (!Object.prototype.hasOwnProperty.call(en, key))
          missing.push(`${file}: missing catalog message ${key}`);
      }
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(ast) === "label" &&
        ts.isStringLiteral(node.initializer)
      ) {
        let ancestor: ts.Node | undefined = node.parent;
        while (
          ancestor &&
          !ts.isVariableDeclaration(ancestor) &&
          !(
            ts.isCallExpression(ancestor) &&
            ancestor.expression.getText(ast) === "exportToCsv"
          )
        )
          ancestor = ancestor.parent;
        const isExport =
          ancestor &&
          (ts.isCallExpression(ancestor) ||
            (ts.isVariableDeclaration(ancestor) &&
              ancestor.name.getText(ast) === "columns"));
        const key = node.initializer.text;
        if (
          !isExport &&
          !identities.has(key) &&
          !["English", "Español", "Português (Brasil)"].includes(key) &&
          !Object.prototype.hasOwnProperty.call(en, key)
        )
          missing.push(`${file}: missing label message ${key}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  expect(missing).toEqual([]);
});

it("requires every named translation call to exist in every language instead of relying on an English default", () => {
  const missing: string[] = [];
  for (const [file, source] of Object.entries(sources)) {
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(ast) === "t" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const key = node.arguments[0].text;
        for (const [language, catalog] of Object.entries({
          en: legacyEn,
          es: legacyEs,
          "pt-BR": legacyPt,
        })) {
          let value: unknown = catalog;
          for (const part of key.split("."))
            value =
              value && typeof value === "object"
                ? (value as Record<string, unknown>)[part]
                : undefined;
          if (value === undefined)
            missing.push(`${file}: missing ${language} named message ${key}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  expect(missing).toEqual([]);
});
it("allows English identity only for explicitly reviewed brands, units, examples and shared words", () => {
  for (const [locale, messages] of Object.entries({ es, "pt-BR": pt })) {
    const identical = Object.entries(messages)
      .filter(
        ([key, value]) =>
          value === (en as Record<string, string>)[key] && !identities.has(key),
      )
      .map(([key]) => key);
    expect(identical, locale).toEqual([]);
  }
});
