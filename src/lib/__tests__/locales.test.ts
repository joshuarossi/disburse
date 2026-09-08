import { describe, expect, it } from "vitest";
import en from "../../locales/en/translation.json";
import es from "../../locales/es/translation.json";
import pt from "../../locales/pt-BR/translation.json";

function strings(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      Object.entries(strings(child, prefix ? `${prefix}.${key}` : key)),
    ),
  );
}
const source = strings(en);
for (const [language, catalog] of Object.entries({ es, "pt-BR": pt })) {
  describe(`${language} public and retained translation catalog`, () => {
    it("retains every English key and the exact interpolation variables for prices, counts and dates", () => {
      const translated = strings(catalog);
      expect(Object.keys(translated).sort()).toEqual(
        Object.keys(source).sort(),
      );
      const variables = (text: string) =>
        [...text.matchAll(/{{\s*-?\s*([^},\s]+)(?:[^}]*)}}/g)]
          .map((match) => match[1])
          .sort();
      for (const [key, text] of Object.entries(translated)) {
        expect(text.trim(), key).not.toBe("");
        expect(variables(text), key).toEqual(variables(source[key]));
      }
    });
  });
}
