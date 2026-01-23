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
  columns: CsvColumn[]
): void {
  // Generate header row
  const header = columns.map((c) => escapeValue(c.label)).join(',');

  // Generate data rows
  const data = rows
    .map((row) =>
      columns
        .map((c) => {
          const value = row[c.key];
          return escapeValue(value);
        })
        .join(',')
    )
    .join('\n');

  // Combine header and data
  const csvContent = header + '\n' + data;

  // Create blob and trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Escape a value for CSV format
 * - Wraps in quotes if contains comma, quote, or newline
 * - Doubles any existing quotes
 */
function escapeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  // If contains special characters, wrap in quotes and escape existing quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
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
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
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
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsText(file);
  });
}

/**
 * Parse CSV text into rows
 * Handles quoted fields, commas, and newlines
 */
function parseCsvText(text: string): CsvRow[] {
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;
  
  // Split by newlines while respecting quoted fields
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentLine += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
        currentLine += char;
      }
    } else if (char === '\n' || char === '\r') {
      if (!inQuotes) {
        if (currentLine.trim()) {
          lines.push(currentLine);
        }
        currentLine = '';
        // Skip \r\n combination
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
      } else {
        currentLine += char;
      }
    } else {
      currentLine += char;
    }
  }
  
  // Add last line if not empty
  if (currentLine.trim()) {
    lines.push(currentLine);
  }
  
  if (lines.length === 0) {
    throw new Error('CSV file is empty');
  }
  
  // Parse header
  const header = parseCsvLine(lines[0]);
  const requiredColumns = ['type', 'name', 'wallet_address'];
  const optionalColumns = ['notes'];
  
  // Validate header
  for (const col of requiredColumns) {
    if (!header.includes(col)) {
      throw new Error(`Missing required column: ${col}`);
    }
  }
  
  // Parse data rows
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Partial<CsvRow> = {};
    
    header.forEach((col, index) => {
      if (requiredColumns.includes(col) || optionalColumns.includes(col)) {
        row[col as keyof CsvRow] = values[index]?.trim() || '';
      }
    });
    
    // Only add row if it has required fields
    if (row.type && row.name && row.wallet_address) {
      rows.push(row as CsvRow);
    }
  }
  
  return rows;
}

/**
 * Parse a single CSV line into values
 */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let currentValue = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentValue += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(currentValue);
      currentValue = '';
    } else {
      currentValue += char;
    }
  }
  
  // Add last value
  values.push(currentValue);
  
  return values;
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
  csvAddresses: Map<string, number>
): ValidationResult {
  const errors: string[] = [];
  
  // Validate type
  if (!row.type || !row.type.trim()) {
    errors.push('Type is required');
  } else {
    const type = row.type.trim().toLowerCase();
    if (type !== 'individual' && type !== 'business') {
      errors.push(`Type must be "individual" or "business", got "${row.type}"`);
    }
  }
  
  // Validate name
  if (!row.name || !row.name.trim()) {
    errors.push('Name is required');
  }
  
  // Validate wallet address
  if (!row.wallet_address || !row.wallet_address.trim()) {
    errors.push('Wallet address is required');
  } else {
    const address = row.wallet_address.trim();
    // Basic Ethereum address validation
    if (!address.startsWith('0x') || address.length !== 42) {
      errors.push(`Invalid wallet address format: must start with 0x and be 42 characters`);
    } else {
      // Check for duplicates within CSV
      const lowerAddress = address.toLowerCase();
      const previousRow = csvAddresses.get(lowerAddress);
      if (previousRow !== undefined) {
        errors.push(`Duplicate wallet address in CSV (also in row ${previousRow + 1})`);
      } else {
        csvAddresses.set(lowerAddress, rowIndex);
      }
      
      // Check for duplicates against existing beneficiaries
      if (existingAddresses.has(lowerAddress)) {
        errors.push('Wallet address already exists in your beneficiaries');
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
  const header = 'type,name,wallet_address,notes';
  // Using valid Ethereum addresses that pass checksum validation
  // These are well-known valid addresses (zero address variants with proper checksums)
  const example1 = 'individual,John Doe,0x0000000000000000000000000000000000000001,Monthly contractor';
  const example2 = 'business,Acme Corporation,0x0000000000000000000000000000000000000002,Quarterly payment';
  
  return [header, example1, example2].join('\n');
}
