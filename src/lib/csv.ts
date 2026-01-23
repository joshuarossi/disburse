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
