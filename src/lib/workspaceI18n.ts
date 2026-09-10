import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import messages from "../locales/en/workspace.json";

const escapePattern = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Shared validation and stored workflow notices are authored on the server.
// Match only known, complete messages. Interpolated customer values stay literal.
const templates = Object.entries(messages).flatMap(([key, source]) => {
  if (
    /_(one|other|zero)$/.test(key) ||
    !source.includes("{{") ||
    source.replace(/\{\{\w+\}\}/g, "").length < 20
  )
    return [];
  const names: string[] = [];
  const parts = source.split(/(\{\{\w+\}\})/g).map((part) => {
    const name = /^\{\{(\w+)\}\}$/.exec(part)?.[1];
    if (!name) return escapePattern(part);
    names.push(name);
    return name === "count" ? "(\\d+)" : "([\\s\\S]*?)";
  });
  return [{ key, names, pattern: new RegExp(`^${parts.join("")}$`) }];
});

function resolveMessage(source: string) {
  if (Object.prototype.hasOwnProperty.call(messages, source))
    return { key: source, values: {} };
  if (source.length > 5000) return undefined;
  for (const template of templates) {
    const match = template.pattern.exec(source);
    if (match)
      return {
        key: template.key,
        values: Object.fromEntries(
          template.names.map((name, index) => [
            name,
            name === "count" ? Number(match[index + 1]) : match[index + 1],
          ]),
        ),
      };
  }
}

export function hasWorkspaceMessage(source: string) {
  return resolveMessage(source) !== undefined;
}

/** Only pass application-authored copy and presentation labels to this helper.
 * Customer records, addresses, asset symbols and export fields are not messages.
 * English source messages are keys, so punctuation is never a key separator. */
export function tx(source: string, values?: Record<string, unknown>): string {
  const resolved = values ? undefined : resolveMessage(source);
  return i18n.t(resolved?.key ?? source, {
    ...(values ?? resolved?.values),
    ns: "workspace",
    keySeparator: false,
    nsSeparator: false,
    defaultValue: source,
  });
}

/** Subscribe without changing a component's identity or discarding form state. */
export function useWorkspaceLanguage() {
  return useTranslation().i18n.resolvedLanguage ?? "en";
}

export function workspaceLocale() {
  return i18n.resolvedLanguage ?? "en";
}
