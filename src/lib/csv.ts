/**
 * CSV Export Utility
 * Exports data to CSV format and triggers download
 */

export interface CsvColumn {
  key: string;
  label: string;
}

/**
 * Export data to CSV file and trigger download
 * @param filename - The name of the file to download (without extension)
 * @param rows - Array of data objects to export
 * @param columns - Column definitions with keys and labels
 */
export function exportToCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: CsvColumn[],
): void {
  // Generate header row
  const header = columns.map((c) => escapeValue(c.label)).join(",");

  // Generate data rows
  const data = rows
    .map((row) =>
      columns
        .map((c) => {
          const value = row[c.key];
          return escapeValue(value);
        })
        .join(","),
    )
    .join("\n");

  // Combine header and data
  const csvContent = header + "\n" + data;

  // Create blob and trigger download
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Escape a value for CSV format
 * - Wraps in quotes if contains comma, quote, or newline
 * - Doubles any existing quotes
 * - Neutralizes formula injection (H-01): leading = + - @ \t \r are prefixed
 *   with a single quote so spreadsheet apps treat the cell as text
 */
function escapeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  let str = String(value);

  // CSV injection defense: never allow cells to begin with a formula character
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'` + str;
  }

  // If contains special characters, wrap in quotes and escape existing quotes
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Generate a filename with today's date
 * @param prefix - The prefix for the filename
 * @returns Filename in format: prefix_YYYY-MM-DD
 */
export function generateFilename(prefix: string): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${prefix}_${year}-${month}-${day}`;
}

/**
 * CSV Row interface for beneficiary import
 */
export interface CsvRow {
  type: string;
  name: string;
  wallet_address: string;
  notes?: string;
  email?: string;
  preferred_token?: string;
  preferred_network?: string;
  source_id?: string;
  source_system?: string;
  type_provided?: boolean;
}

/**
 * Validation result for a CSV row
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Parse a CSV file and return rows
 * @param file - The CSV file to parse
 * @returns Promise resolving to array of parsed rows
 */
export async function parseCsvFile(file: File): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCsvText(text);
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read file"));
    };

    reader.readAsText(file);
  });
}

/**
 * Parse CSV text into rows
 * Handles quoted fields, commas, and newlines
 */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  const input = text.replace(/^\uFEFF/, "");
  const firstLine = input.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes("\t") ? "\t" : ",";
  const finishField = () => {
    record.push(field.trim());
    field = "";
    closedQuote = false;
  };
  const finishRecord = () => {
    finishField();
    if (record.some((value) => value !== "")) records.push(record);
    record = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else field += char;
    } else if (char === delimiter) {
      finishField();
    } else if (char === "\n" || char === "\r") {
      finishRecord();
      if (char === "\r" && input[i + 1] === "\n") i++;
    } else if (char === '"' && !field.trim() && !closedQuote) {
      field = "";
      quoted = true;
    } else {
      if (char === '"' || (closedQuote && char.trim())) {
        throw new Error(`Invalid quoting in CSV record ${records.length + 1}`);
      }
      field += char;
    }
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field");
  finishRecord();
  return records;
}

export function normalizeCsvColumn(value: string) {
  const aliases: Record<string, string> = {
    full_name: "name",
    employee_name: "name",
    recipient_name: "name",
    vendor_name: "name",
    wallet: "wallet_address",
    address: "wallet_address",
    ethereum_address: "wallet_address",
    payout_address: "wallet_address",
    payment_address: "wallet_address",
    email_address: "email",
    work_email: "email",
    employee_email: "email",
    personal_email: "email",
    first: "first_name",
    last: "last_name",
    recipient_type: "type",
    employee_first_name: "first_name",
    employee_last_name: "last_name",
    description: "notes",
    currency: "preferred_token",
    token: "preferred_token",
    preferred_currency: "preferred_token",
    payout_currency: "preferred_token",
    preferredtoken: "preferred_token",
    network: "preferred_network",
    chain_id: "preferred_network",
    preferred_chain_id: "preferred_network",
    preferredchainid: "preferred_network",
    payout_network: "preferred_network",
    employee_id: "source_id",
    employee_uuid: "source_id",
    employee_number: "source_id",
    contractor_id: "source_id",
    vendor_id: "source_id",
    external_id: "source_id",
    source: "source_system",
  };
  const normalized = value.trim().toLowerCase().replace(/[ -]+/g, "_");
  return aliases[normalized] ?? normalized;
}

export function parseCsvText(text: string, columnMapping?: string[]): CsvRow[] {
  const [rawHeader, ...data] = parseCsvRecords(text);
  if (columnMapping && columnMapping.length !== rawHeader?.length)
    throw new Error("Match each source column before importing.");
  const header = rawHeader?.map((value, index) =>
    columnMapping
      ? columnMapping[index] || `__ignored_${index}`
      : normalizeCsvColumn(value),
  );
  if (!header) throw new Error("CSV file is empty");
  if (new Set(header).size !== header.length)
    throw new Error("CSV contains duplicate column names");
  if (!header.includes("name") && !header.includes("first_name"))
    throw new Error("Missing required column: name or first name");
  if (
    !header.includes("wallet_address") &&
    !header.includes("email") &&
    !header.includes("source_id")
  )
    throw new Error("Include a wallet address or an email column");
  return data.map((values, index) => {
    if (values.length > header.length)
      throw new Error(`Too many columns in CSV record ${index + 2}`);
    const value = (column: string) => values[header.indexOf(column)] ?? "";
    // Keep incomplete rows so the preview can display validation errors.
    return {
      type: value("type") || "individual",
      name:
        value("name") ||
        [value("first_name"), value("last_name")].filter(Boolean).join(" "),
      wallet_address: value("wallet_address"),
      notes: value("notes"),
      email: value("email"),
      preferred_token: value("preferred_token").trim().toUpperCase(),
      preferred_network: value("preferred_network").trim(),
      source_id: value("source_id").trim(),
      source_system: value("source_system").trim(),
      type_provided: header.includes("type") && !!value("type"),
    };
  });
}

/**
 * Validate a CSV row
 * @param row - The CSV row to validate
 * @param rowIndex - The row index (0-based, excluding header)
 * @param existingAddresses - Set of existing wallet addresses (lowercased)
 * @param csvAddresses - Map of addresses seen in CSV so far (for duplicate detection within CSV)
 * @returns Validation result with errors
 */
export function validateCsvRow(
  row: CsvRow,
  rowIndex: number,
  existingAddresses: Set<string>,
  csvAddresses: Map<string, number>,
  allowMissingPaymentDetails = false,
): ValidationResult {
  const errors: string[] = [];
  try {
    validateSavedPayoutInstructions({
      preferredToken: row.preferred_token,
      preferredChainId: parsePayoutNetwork(row.preferred_network ?? ""),
    });
  } catch (error) {
    errors.push(
      error instanceof Error ? error.message : "Invalid payout instructions",
    );
  }

  // Validate type
  if (!row.type || !row.type.trim()) {
    errors.push("Type is required");
  } else {
    const type = row.type.trim().toLowerCase();
    if (type !== "individual" && type !== "business") {
      errors.push(`Type must be "individual" or "business", got "${row.type}"`);
    }
  }

  // Validate name
  if (!row.name || !row.name.trim()) {
    errors.push("Name is required");
  }

  // Validate wallet address
  if (!row.wallet_address || !row.wallet_address.trim()) {
    if (
      !allowMissingPaymentDetails ||
      (!row.source_id &&
        (!row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)))
    ) {
      errors.push(
        allowMissingPaymentDetails
          ? "Provide a wallet address or a valid email to collect payment details later"
          : "Wallet address is required",
      );
    }
  } else {
    const address = row.wallet_address.trim();
    // Full hex validation: 0x + 40 hexadecimal characters (H-03)
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      errors.push(
        `Invalid wallet address format: must be 0x followed by 40 hexadecimal characters`,
      );
    } else {
      // Check for duplicates within CSV
      const lowerAddress = address.toLowerCase();
      const previousRow = csvAddresses.get(lowerAddress);
      if (previousRow !== undefined) {
        errors.push(
          `Duplicate wallet address in CSV (also in row ${previousRow + 1})`,
        );
      } else {
        csvAddresses.set(lowerAddress, rowIndex);
      }

      // Check for duplicates against existing beneficiaries
      if (existingAddresses.has(lowerAddress)) {
        errors.push("Wallet address already exists in your beneficiaries");
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Generate CSV template content
 * @returns CSV template string
 */
export function generateCsvTemplate(): string {
  const header =
    "type,name,email,wallet_address,preferred_token,preferred_network,notes";
  // Using valid Ethereum addresses that pass checksum validation
  // These are well-known valid addresses (zero address variants with proper checksums)
  const example1 =
    "individual,John Doe,john@example.com,,USDC,Base,Add a payment address before paying";
  const example2 =
    "business,Acme Corporation,accounts@example.com,,USDC,Base,Vendor invoice payments";

  return [header, example1, example2].join("\n");
}
import {
  parsePayoutNetwork,
  validateSavedPayoutInstructions,
} from "../../shared/payoutInstructions";
