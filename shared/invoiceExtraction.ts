export type InvoiceSuggestions = {
  invoiceNumber?: string;
  amount?: string;
  dueDate?: string;
  token?: string;
  documentCurrency?: string;
  warnings: string[];
};

function dateValue(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  let year: number, month: number, day: number;
  if (iso) [, year, month, day] = iso.map(Number);
  else {
    const names = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const words =
      /^(?:(\d{1,2})\s+)?([a-z]+)\s+(?:(\d{1,2}),?\s+)?(\d{4})$/i.exec(
        raw.trim(),
      );
    if (words) {
      year = Number(words[4]);
      month =
        names.findIndex(
          (n) =>
            n === words[2].toLowerCase() ||
            n.slice(0, 3) === words[2].toLowerCase(),
        ) + 1;
      day = Number(words[1] || words[3]);
    } else {
      const numeric = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(raw.trim());
      if (!numeric) return null;
      const first = Number(numeric[1]),
        second = Number(numeric[2]);
      if (first <= 12 && second <= 12 && first !== second) return null;
      year = Number(numeric[3]);
      month = first > 12 ? second : first;
      day = first > 12 ? first : second;
    }
  }
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1)
    return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day
    ? d.toISOString().slice(0, 10)
    : null;
}

function moneyValue(raw: string): string | null {
  const value = raw
    .replace(/(?:USDC|USDT|PYUSD|EURC|USD|EUR|[$€])/gi, "")
    .trim();
  if (!/^[\d.,\s]+$/.test(value)) return null;
  let normalized = value;
  if (value.includes(",") && value.includes(".")) {
    if (/^\d{1,3}(,\d{3})+\.\d{1,6}$/.test(value))
      normalized = value.replace(/,/g, "");
    else if (/^\d{1,3}(\.\d{3})+,\d{1,6}$/.test(value))
      normalized = value.replace(/\./g, "").replace(",", ".");
    else return null;
  } else if (value.includes(",")) {
    if (/^\d+,\d{2}$/.test(value)) normalized = value.replace(",", ".");
    else return null; // A single separator with three digits is locale-ambiguous.
  } else if (/^\d{1,3}( \d{3})+(\.\d{1,6})?$/.test(value))
    normalized = value.replace(/ /g, "");
  if (
    !/^\d+(\.\d{1,6})?$/.test(normalized) ||
    normalized.replace(/\./g, "").length > 24
  )
    return null;
  const [whole, fraction = ""] = normalized.split(".");
  if (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")) <= 0n)
    return null;
  const decimal = fraction.replace(/0+$/, "");
  return BigInt(whole).toString() + (decimal ? `.${decimal}` : "");
}

/** Conservative, deterministic suggestions. Never extracts payment destinations. */
export function extractInvoiceSuggestions(text: string): InvoiceSuggestions {
  const lines = text
    .slice(0, 200_000)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const result: InvoiceSuggestions = { warnings: [] };
  const takeUnique = (values: Array<string | null>, field: string) => {
    const unique = [...new Set(values.filter((v): v is string => v !== null))];
    if (values.some((v) => v === null) || unique.length > 1) {
      result.warnings.push(
        `${field} is ambiguous. Enter it from the original document.`,
      );
      return undefined;
    }
    return unique[0];
  };
  const numbers = lines.flatMap((line) => {
    const m =
      /^invoice\s*(?:number|no\.?|id|#)\s*[:#]?\s*([\w][\w./-]{0,99})$/i.exec(
        line,
      );
    return m ? [m[1]] : [];
  });
  result.invoiceNumber = takeUnique(numbers, "Invoice number");
  const dates = lines.flatMap((line) => {
    const m = /^(?:payment\s+)?due\s+date\s*:?\s+(.+)$/i.exec(line);
    return m ? [dateValue(m[1])] : [];
  });
  result.dueDate = takeUnique(dates, "Due date");
  const groups = [
    /^(?:amount|balance|total)\s+due\s*:?\s+(.+)$/i,
    /^(?:invoice|grand)\s+total\s*:?\s+(.+)$/i,
    /^total\s*:?\s+(.+)$/i,
  ];
  for (const group of groups) {
    const values = lines.flatMap((line) => {
      const m = group.exec(line);
      return m ? [m[1]] : [];
    });
    if (!values.length) continue;
    result.amount = takeUnique(values.map(moneyValue), "Amount due");
    const currencies = values
      .flatMap(
        (value) => value.match(/\b(?:USDC|USDT|PYUSD|EURC|USD|EUR)\b/gi) ?? [],
      )
      .map((t) => t.toUpperCase());
    result.documentCurrency = takeUnique(currencies, "Document currency");
    if (
      result.documentCurrency &&
      ["USDC", "USDT", "PYUSD", "EURC"].includes(result.documentCurrency)
    )
      result.token = result.documentCurrency;
    break;
  }
  if (result.documentCurrency && !result.token)
    result.warnings.push(
      `The document is denominated in ${result.documentCurrency}. Confirm the agreed payment currency with the recipient.`,
    );
  if (!result.invoiceNumber && !result.amount && !result.dueDate)
    result.warnings.push(
      "No unambiguous invoice fields were found. Enter the details from the original document.",
    );
  return result;
}
