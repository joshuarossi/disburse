import { useEffect, useRef, useState } from "react";
import { FileText, Upload, Download } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { readInvoiceDocument } from "@/lib/readInvoiceDocument";
import type { InvoiceSuggestions } from "../../../shared/invoiceExtraction";
import { MAX_INVOICE_FILE_BYTES } from "../../../shared/invoiceSource";
import { downloadInvoiceFile } from "@/lib/invoiceFileClient";
import { useSessionToken } from "@/lib/session";
import {
  LoadingRows,
  Notice,
} from "@/components/workspace/WorkspacePrimitives";

export type SelectedInvoiceSource = {
  file: File;
  requestId: string;
  uploadedId?: Id<"invoiceFiles">;
  document?: Awaited<ReturnType<typeof readInvoiceDocument>>;
  error?: string;
};

export function InvoiceSource({
  source,
  onChange,
  onApply,
  onReading,
  disabled,
}: {
  source: SelectedInvoiceSource | null;
  onChange: (source: SelectedInvoiceSource | null) => void;
  onApply: (suggestions: InvoiceSuggestions) => void;
  onReading: (reading: boolean) => void;
  disabled: boolean;
}) {
  const sequence = useRef(0);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [localUrl, setLocalUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const selectedFile = source?.file;
  useEffect(() => {
    const url = selectedFile ? URL.createObjectURL(selectedFile) : "";
    setLocalUrl(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [selectedFile]);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  return (
    <section
      aria-label="Source document"
      className="space-y-4 rounded-xl border border-white/10 p-4"
    >
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <FileText size={16} />
          Source document
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Attach the invoice and review suggested details. PDF, image or text
          file · up to 10 MB.
        </p>
      </div>
      {error && <Notice>{error}</Notice>}
      <label className="block">
        <span className="finance-label">
          {source
            ? "Replace the selected document"
            : "Choose an invoice file (optional)"}
        </span>
        <input
          ref={input}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp,text/plain"
          disabled={disabled}
          className="finance-field !p-2"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (!file.size || file.size > MAX_INVOICE_FILE_BYTES) {
              setError("Choose a file between 1 byte and 10 MB.");
              e.target.value = "";
              return;
            }
            setError("");
            const current = ++sequence.current;
            const next: SelectedInvoiceSource = {
              file,
              requestId: crypto.randomUUID(),
            };
            onChange(next);
            setReading(true);
            onReading(true);
            try {
              const { readInvoiceDocument } =
                await import("@/lib/readInvoiceDocument");
              const document = await readInvoiceDocument(file);
              if (sequence.current === current) onChange({ ...next, document });
            } catch {
              if (sequence.current === current)
                onChange({
                  ...next,
                  error:
                    "Suggested fields could not be read. You can keep the source document and enter the details manually. Scanned images and password-protected PDFs need manual entry.",
                });
            } finally {
              if (sequence.current === current) {
                setReading(false);
                onReading(false);
              }
            }
          }}
        />
      </label>
      {source && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="min-w-0 break-all font-medium">
              {source.file.name}
              <span className="ml-2 text-xs font-normal text-slate-400">
                {(source.file.size / 1024).toFixed(0)} KB
              </span>
            </p>
            <button
              type="button"
              className="workspace-action-link"
              disabled={disabled}
              onClick={() => {
                sequence.current++;
                setReading(false);
                onReading(false);
                onChange(null);
                if (input.current) input.current.value = "";
              }}
            >
              Remove selection
            </button>
          </div>
          {reading && (
            <p role="status" className="text-sm text-slate-400">
              Reading the document on this device…
            </p>
          )}
          {source.error && <Notice tone="info">{source.error}</Notice>}
          {source.document?.suggestions.warnings.map((warning) => (
            <p
              key={warning}
              className="text-xs leading-5 workspace-funding-warning"
            >
              {warning}
            </p>
          ))}
          {source.document && (
            <>
              {source.document.preview ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    View source · page 1 of {source.document.pages}
                  </summary>
                  <img
                    src={source.document.preview}
                    alt="First page of the source invoice"
                    className="mt-3 max-h-[480px] w-full rounded-md bg-white object-contain"
                  />
                </details>
              ) : source.file.type.startsWith("image/") && localUrl ? (
                <img
                  src={localUrl}
                  alt="Source invoice"
                  className="max-h-72 w-full rounded-md object-contain"
                />
              ) : null}
              {source.document.text && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    Read extracted text
                  </summary>
                  <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 p-3 text-xs leading-5">
                    {source.document.text}
                  </pre>
                </details>
              )}
              {(source.document.suggestions.invoiceNumber ||
                source.document.suggestions.amount ||
                source.document.suggestions.dueDate ||
                source.document.suggestions.token) && (
                <div className="space-y-3 rounded-lg border border-white/10 p-3">
                  <h4 className="text-sm font-medium">
                    Suggested bill details
                  </h4>
                  <dl className="grid gap-3 text-xs sm:grid-cols-2">
                    {(
                      [
                        [
                          "Invoice number",
                          source.document.suggestions.invoiceNumber,
                        ],
                        ["Amount due", source.document.suggestions.amount],
                        ["Due date", source.document.suggestions.dueDate],
                        ["Payment currency", source.document.suggestions.token],
                      ] as const
                    ).map(
                      ([label, value]) =>
                        value && (
                          <div key={label}>
                            <dt className="text-slate-400">{label}</dt>
                            <dd className="mt-1 break-all font-medium">
                              {value}
                            </dd>
                          </div>
                        ),
                    )}
                  </dl>
                  <button
                    type="button"
                    className="workspace-button"
                    disabled={disabled}
                    onClick={() => onApply(source.document!.suggestions)}
                  >
                    <Upload size={13} />
                    Use suggested fields
                  </button>
                  <p className="text-xs leading-5 text-slate-400">
                    This replaces the matching fields below. Choose the saved
                    recipient and review the complete bill before saving.
                  </p>
                </div>
              )}
            </>
          )}
          {localUrl && (
            <a
              className="workspace-action-link"
              href={localUrl}
              download={source.file.name}
            >
              <Download size={13} />
              Download original source
            </a>
          )}
        </>
      )}
    </section>
  );
}

export function InvoiceAttachments({
  invoiceId,
}: {
  invoiceId: Id<"invoices">;
}) {
  const sessionToken = useSessionToken();
  const files = useQuery(
    api.invoiceFiles.list,
    sessionToken ? { invoiceId, sessionToken } : "skip",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <section
      aria-label="Saved source documents"
      className="space-y-3 border-t border-white/10 pt-4"
    >
      <h3 className="font-semibold">Source documents</h3>
      {error && <Notice>{error}</Notice>}
      {!files ? (
        <LoadingRows />
      ) : !files.length ? (
        <p className="text-sm text-slate-400">No source document attached.</p>
      ) : (
        <ul className="space-y-3">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3"
            >
              <div className="min-w-0">
                <p className="break-all text-sm font-medium">{file.name}</p>
                <p className="text-xs text-slate-400">
                  {(file.size / 1024).toFixed(0)} KB ·{" "}
                  {new Date(file.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                className="workspace-button"
                disabled={!!busy}
                onClick={async () => {
                  if (!sessionToken || busy) return;
                  setBusy(file.id);
                  setError("");
                  try {
                    await downloadInvoiceFile(file.id, file.name, sessionToken);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "The document could not be downloaded.",
                    );
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Download size={13} />
                {busy === file.id ? "Downloading…" : "Download source"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
