export const MAX_INVOICE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_INVOICE_FILES = 5;
export const INVOICE_FILE_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
] as const;
export type InvoiceFileType = (typeof INVOICE_FILE_TYPES)[number];
export function invoiceFileType(
  bytes: Uint8Array,
  declared: string,
): InvoiceFileType {
  if (!bytes.length || bytes.length > MAX_INVOICE_FILE_BYTES)
    throw new Error("Choose a file between 1 byte and 10 MB.");
  // Binary length bytes in RIFF headers must not shift character offsets.
  const ascii = String.fromCharCode(...bytes.slice(0, 12));
  const type = ascii.startsWith("%PDF-")
    ? "application/pdf"
    : bytes[0] === 137 &&
        ascii.slice(1, 4) === "PNG" &&
        bytes[4] === 13 &&
        bytes[5] === 10 &&
        bytes[6] === 26 &&
        bytes[7] === 10
      ? "image/png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? "image/jpeg"
        : ascii.startsWith("RIFF") && ascii.slice(8) === "WEBP"
          ? "image/webp"
          : declared === "text/plain" && !bytes.includes(0)
            ? "text/plain"
            : null;
  if (!type || type !== declared)
    throw new Error(
      "Use a PDF, PNG, JPEG, WebP or plain text file with a matching file type.",
    );
  return type;
}
export function invoiceFileName(value: string) {
  const name = value.replace(/[\p{Cc}/\\]/gu, "_").trim();
  if (!name || name.length > 180)
    throw new Error("Use a file name between 1 and 180 characters.");
  return name;
}
