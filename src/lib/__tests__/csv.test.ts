import { describe, expect, it, vi } from "vitest";
import { exportToCsv, parseCsvText, validateCsvRow } from "../csv";

it("exports negative reconciliation units as numbers while protecting formula-like text", async () => {
  let output: Blob | undefined;
  const createObjectURL = vi.fn((blob: Blob) => { output = blob; return 'blob:csv-test'; });
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    exportToCsv('balances', [{ difference: '-5', name: '-5', unsafe: '-5+SUM(1,2)' }], [
      { key: 'difference', label: 'Difference', numeric: true },
      { key: 'name', label: 'Label' },
      { key: 'unsafe', label: 'Unsafe', numeric: true },
    ]);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(output!);
    });
    expect(text).toBe('Difference,Label,Unsafe\n-5,\'-5,"\'-5+SUM(1,2)"');
  } finally { click.mockRestore(); vi.unstubAllGlobals(); }
});

const header = "type,name,wallet_address,notes";
const address = "0x" + "1".repeat(40);

describe("beneficiary CSV parsing", () => {
  it("preserves escaped quotes, commas and multiline notes", () => {
    const [row] = parseCsvText(
      `${header}\r\nindividual,"Jane ""JJ"", Doe",${address},"First line\nSecond line"`,
    );
    expect(row.name).toBe('Jane "JJ", Doe');
    expect(row.notes).toBe("First line\nSecond line");
  });

  it("accepts a BOM and whitespace around header fields", () => {
    expect(
      parseCsvText(
        `\uFEFFtype, name, wallet_address\nindividual,Jane,${address}`,
      )[0].name,
    ).toBe("Jane");
  });

  it("keeps incomplete records visible to validation", () => {
    const rows = parseCsvText(
      `${header}\nindividual,,${address},Missing name\nindividual,Jane,,Missing address`,
    );
    expect(rows).toHaveLength(2);
    expect(validateCsvRow(rows[0], 0, new Set(), new Map()).errors).toContain(
      "Name is required",
    );
    expect(validateCsvRow(rows[1], 1, new Set(), new Map()).errors).toContain(
      "Wallet address is required",
    );
  });

  it.each([
    [`${header}\nindividual,"Jane,${address},`, /unterminated/],
    [`${header}\nindividual,"Jane"oops,${address},`, /quoting/],
    ["type,name,name,wallet_address", /duplicate/],
    [`${header}\nindividual,Jane,${address},notes,extra`, /Too many columns/],
  ])("rejects malformed input %s", (input, message) => {
    expect(() => parseCsvText(input)).toThrow(message);
  });
});

describe("employee exports and pasted spreadsheets", () => {
  it("preserves payout currency and network instead of discarding import columns", () => {
    const [row] = parseCsvText(
      `Name,Email,Payout Currency,Network\nMaya Chen,maya@example.com,usdc,Base`,
    );
    expect(row).toMatchObject({
      preferred_token: "USDC",
      preferred_network: "Base",
    });
    expect(validateCsvRow(row, 0, new Set(), new Map(), true).isValid).toBe(
      true,
    );
  });
  it.each([
    ["USD", "Base", "Unsupported payout currency"],
    ["USDC", "Solana", "Unsupported payout network"],
    ["USDT", "Base Sepolia", "not supported"],
  ])(
    "keeps unsupported payout instructions visible as invalid rows: %s on %s",
    (token, network, error) => {
      const [row] = parseCsvText(
        `Name,Email,Currency,Network\nMaya,maya@example.com,${token},${network}`,
      );
      expect(
        validateCsvRow(row, 0, new Set(), new Map(), true).errors.join(" "),
      ).toContain(error);
    },
  );
  it("maps first name, last name and work email without a payout address", () => {
    const [row] = parseCsvText(
      "First Name,Last Name,Work Email\nJamie,Chen,jamie@example.com",
    );
    expect(row).toMatchObject({
      name: "Jamie Chen",
      type: "individual",
      email: "jamie@example.com",
      wallet_address: "",
    });
    expect(validateCsvRow(row, 0, new Set(), new Map(), true).isValid).toBe(
      true,
    );
    expect(validateCsvRow(row, 0, new Set(), new Map()).isValid).toBe(false);
  });
  it("accepts tab-separated clipboard data and common wallet headings", () => {
    const [row] = parseCsvText(`Name\tWallet Address\nJamie Chen\t${address}`);
    expect(row).toMatchObject({ name: "Jamie Chen", wallet_address: address });
  });
});

describe("explicit employee field mapping", () => {
  it("maps unfamiliar export columns while preserving requested payout details", () => {
    const rows = parseCsvText(
      "Display,Contact,Coin,Route,Ignored\nJamie,jamie@example.com,USDT,Base,private data",
      ["name", "email", "preferred_token", "preferred_network", ""],
    );
    expect(rows[0]).toMatchObject({
      name: "Jamie",
      email: "jamie@example.com",
      preferred_token: "USDT",
      preferred_network: "Base",
      wallet_address: "",
    });
    expect(JSON.stringify(rows)).not.toContain("private data");
  });
  it("rejects ambiguous mappings instead of selecting the wrong column", () => {
    expect(() =>
      parseCsvText(
        "Name,Work,Personal\nJamie,jamie@example.com,other@example.com",
        ["name", "email", "email"],
      ),
    ).toThrow("duplicate column");
    expect(
      parseCsvText(
        "Name,Work,Personal\nJamie,jamie@example.com,other@example.com",
        ["name", "email", ""],
      )[0].email,
    ).toBe("jamie@example.com");
  });
});
