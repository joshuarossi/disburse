import { userErrorMessage } from '@/lib/userErrors';
import { Dialog } from "@/components/ui/Dialog";
import { Fragment, useState, useCallback, useMemo, useRef } from "react";
import { useSessionToken } from "@/lib/session";
import { Link } from "react-router-dom";
import {
  importFingerprint,
  planRecipientImport,
  type ImportedRecipient,
} from "../../../shared/recipientImport";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Download,
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  parseCsvText,
  parseCsvRecords,
  normalizeCsvColumn,
  validateCsvRow,
  generateCsvTemplate,
  type CsvRow,
} from "@/lib/csv";
import { isValidEthereumAddress } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface BulkImportModalProps {
  orgId: Id<"orgs">;
  onClose: () => void;
  onSuccess: () => void;
}

interface ValidatedRow extends CsvRow {
  rowIndex: number;
  isValid: boolean;
  errors: string[];
  isSelected: boolean;
}

export function BulkImportModal({
  orgId,
  onClose,
  onSuccess,
}: BulkImportModalProps) {
  const sessionToken = useSessionToken();
  const [sourceSystem, setSourceSystem] = useState("csv");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState<{
    created: number;
    updated: number;
    reviewRequested: number;
    skipped: number;
  } | null>(null);
  const attempt = useRef<{ hash: string; requestId: string } | null>(null);
  const receiptKey = `disburse:recipient-import:${orgId}`;
  const [submitted, setSubmitted] = useState<{
    requestId: string;
    hash: string;
    skipped: number;
  } | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(receiptKey) ?? "null");
      return saved &&
        typeof saved.requestId === "string" &&
        typeof saved.hash === "string" &&
        typeof saved.skipped === "number"
        ? saved
        : null;
    } catch {
      return null;
    }
  });
  const receipt = useQuery(
    api.recipientImports.status,
    sessionToken && submitted
      ? {
          orgId,
          sessionToken,
          requestId: submitted.requestId,
          requestHash: submitted.hash,
        }
      : "skip",
  );
  const completed =
    saved ??
    (receipt && submitted ? { ...receipt, skipped: submitted.skipped } : null);
  const finish = () => {
    try {
      sessionStorage.removeItem(receiptKey);
    } catch {
      /* Storage is optional for the current-session receipt. */
    }
    onSuccess();
    onClose();
  };
  const { t } = useTranslation();
  const [paste, setPaste] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [sample, setSample] = useState<string[]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [mappingDirty, setMappingDirty] = useState(false);
  const importFields = [
    ["name", "Full name"],
    ["first_name", "First name"],
    ["last_name", "Last name"],
    ["email", "Email"],
    ["wallet_address", "Payment address"],
    ["preferred_token", "Requested currency"],
    ["preferred_network", "Payment network"],
    ["type", "Recipient type"],
    ["notes", "Notes"],
    ["source_id", "Source employee or vendor ID"],
    ["source_system", "Source system"],
  ];
  const [validatedRows, setValidatedRows] = useState<ValidatedRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get existing beneficiaries to check for duplicates
  const existingBeneficiaries = useQuery(
    api.beneficiaries.list,
    orgId && sessionToken ? { orgId, sessionToken } : "skip",
  );

  const commitImport = useMutation(api.recipientImports.commit);
  const plans = useMemo(
    () =>
      planRecipientImport(
        validatedRows.map((row) => ({
          name: row.name,
          type: row.type_provided
            ? (row.type.trim().toLowerCase() as ImportedRecipient["type"])
            : undefined,
          email: row.email,
          walletAddress: row.wallet_address,
          notes: row.notes,
          preferredToken: row.preferred_token || undefined,
          preferredChainId: (() => {
            try {
              return parsePayoutNetwork(row.preferred_network ?? "");
            } catch {
              return undefined;
            }
          })(),
          sourceId: row.source_id,
          sourceSystem: row.source_system || sourceSystem,
        })),
        existingBeneficiaries ?? [],
      ),
    [validatedRows, existingBeneficiaries, sourceSystem],
  );
  const selectable = (index: number) =>
    validatedRows[index].isValid &&
    !plans[index].errors.length &&
    plans[index].recommendation !== "skip";

  // Download template
  const handleDownloadTemplate = useCallback(() => {
    const template = generateCsvTemplate();
    const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "beneficiary_import_template.csv";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback(
    async (selectedFile: File, columnMapping?: string[]) => {
      if (!/[.](csv|tsv)$/i.test(selectedFile.name)) {
        setImportError(t("beneficiaries.bulkImport.errors.invalidFileType"));
        return;
      }

      // Check file size (5MB limit)
      if (selectedFile.size > 5 * 1024 * 1024) {
        setImportError(t("beneficiaries.bulkImport.errors.fileTooLarge"));
        return;
      }

      setValidatedRows([]);
      setFile(selectedFile);
      setImportError(null);
      setParsing(true);

      try {
        const text = await selectedFile.text();
        const [headers, firstRow] = parseCsvRecords(text);
        setSourceColumns(headers ?? []);
        setSample(firstRow ?? []);
        if (!columnMapping)
          setMapping(
            (headers ?? []).map((header) => normalizeCsvColumn(header)),
          );
        const rows = parseCsvText(text, columnMapping);
        setMappingDirty(false);

        if (rows.length === 0) {
          setImportError(t("beneficiaries.bulkImport.errors.noData"));
          setParsing(false);
          return;
        }

        if (rows.length > 500)
          throw new Error(
            "Import up to 500 recipients at a time. Split this file into smaller groups.",
          );

        // Validate each row
        const csvAddresses = new Map<string, number>();
        const emails = new Set<string>();
        const validated: ValidatedRow[] = rows.map((row, index) => {
          // Additional validation with viem
          const validation = validateCsvRow(
            row,
            index,
            new Set(),
            csvAddresses,
            true,
          );

          if (row.email) {
            const email = row.email.trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
              validation.errors.push("Invalid email address");
            if (emails.has(email))
              validation.errors.push("Duplicate email in this import");
            emails.add(email);
            validation.isValid = validation.errors.length === 0;
          }
          // Double-check wallet address with viem
          if (validation.isValid && row.wallet_address) {
            if (!isValidEthereumAddress(row.wallet_address.trim())) {
              validation.isValid = false;
              validation.errors.push(
                t("beneficiaries.bulkImport.errors.invalidAddress"),
              );
            }
          }

          return {
            ...row,
            rowIndex: index,
            isValid: validation.isValid,
            errors: validation.errors,
            isSelected: validation.isValid, // Default: select valid rows
          };
        });

        setValidatedRows(validated);
      } catch (error) {
        console.error("Failed to parse CSV:", error);
        setImportError(
          userErrorMessage(error, t("beneficiaries.bulkImport.errors.parseError")),
        );
      } finally {
        setParsing(false);
      }
    },
    [t],
  );

  // Handle drag and drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        handleFileSelect(droppedFile);
      }
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Toggle row selection
  const toggleRowSelection = useCallback((rowIndex: number) => {
    setValidatedRows((prev) =>
      prev.map((row) =>
        row.rowIndex === rowIndex
          ? { ...row, isSelected: !row.isSelected }
          : row,
      ),
    );
  }, []);

  // The server repeats matching and checks each reviewed record before changing it.
  const handleImport = async () => {
    if (!sessionToken || !existingBeneficiaries || isImporting || mappingDirty)
      return;
    const chosen = plans.filter(
      (_, i) => validatedRows[i].isSelected && selectable(i),
    );
    if (!chosen.length) {
      setImportError("Choose at least one new or changed recipient.");
      return;
    }
    const rows = chosen.map((plan) => ({
      recipient: plan.row,
      operation: plan.recommendation as "create" | "update",
      existingId: plan.existingId as Id<"beneficiaries"> | undefined,
      expectedFingerprint: plan.expectedFingerprint,
    }));
    const hash = importFingerprint(rows);
    if (!attempt.current || attempt.current.hash !== hash)
      attempt.current = { hash, requestId: crypto.randomUUID() };
    const submitted = {
      ...attempt.current,
      skipped: validatedRows.length - chosen.length,
    };
    setSubmitted(submitted);
    try {
      sessionStorage.setItem(receiptKey, JSON.stringify(submitted));
    } catch {
      /* Keep the in-memory receipt if browser storage is disabled. */
    }
    setIsImporting(true);
    setImportError(null);
    try {
      const result = await commitImport({
        orgId,
        sessionToken,
        requestId: attempt.current.requestId,
        rows,
      });
      setSaved({ ...result, skipped: validatedRows.length - chosen.length });
    } catch (e) {
      setImportError(
        userErrorMessage(e, "Could not import the selected changes. Review the preview and try again."),
      );
    } finally {
      setIsImporting(false);
    }
  };

  const validSelectedCount = validatedRows.filter(
    (r, i) => r.isSelected && selectable(i),
  ).length;
  const canDismiss = !parsing && !isImporting;

  if (completed)
    return (
      <Dialog title="Import complete" onClose={finish}>
        <div className="space-y-5 p-6">
          <p role="status">
            {completed.created} created · {completed.updated} updated ·{" "}
            {completed.skipped} skipped
          </p>
          <p className="text-sm text-slate-400">
            {completed.reviewRequested
              ? `${completed.reviewRequested} payout record${completed.reviewRequested === 1 ? "" : "s"} ${completed.reviewRequested === 1 ? "needs" : "need"} review before payment. Existing approved instructions remain in place until the review is complete.`
              : "Saved payout instructions were preserved. No payments were created."}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              className="workspace-button workspace-button-primary"
              to={`/org/${orgId}/beneficiaries${completed.reviewRequested ? "?view=review" : ""}`}
              onClick={() => {
                try {
                  sessionStorage.removeItem(receiptKey);
                } catch {
                  /* Storage is optional for the current-session receipt. */
                }
                onClose();
              }}
            >
              {completed.reviewRequested
                ? "Review payout details"
                : "View recipients"}
            </Link>
            <Button variant="secondary" onClick={finish}>
              Done
            </Button>
          </div>
        </div>
      </Dialog>
    );
  return (
    <Dialog
      title="Import recipients"
      onClose={() => {
        if (canDismiss) onClose();
      }}
    >
      <div className="p-6">
        {/* Error Message */}
        {importError && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{importError}</span>
          </div>
        )}

        {!validatedRows.length && (
          <div className="mb-6 rounded-lg border border-white/10 bg-navy-800/50 p-5">
            <h3 className="font-medium text-white">
              Bring your existing recipient list
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Upload a CSV from your payroll or accounting tool, or paste rows
              from a spreadsheet. We recognize names, first and last names,
              email, and payment addresses. Match repeated imports using
              employee IDs from your source system.
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              No payment addresses yet? Import names and emails now, then add
              payment details from the recipient list before paying. Only import
              the columns you need; leave out tax IDs and bank details.
            </p>
            <Button
              className="mt-3"
              variant="ghost"
              size="sm"
              onClick={handleDownloadTemplate}
            >
              <Download className="h-4 w-4" />
              Download example CSV
            </Button>
          </div>
        )}
        <label className="mb-5 block">
          <span className="finance-label">
            Source system for employee or vendor IDs
          </span>
          <select
            className="finance-field"
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value)}
          >
            <option value="csv">Spreadsheet / CSV</option>
            <option value="gusto">Gusto</option>
            <option value="quickbooks">QuickBooks</option>
            <option value="xero">Xero</option>
            <option value="deel">Deel</option>
            <option value="rippling">Rippling</option>
          </select>
          <span className="mt-2 block text-xs text-slate-400">
            Use the same source on future imports. Empty cells keep existing
            values. Payout changes always require review.
          </span>
        </label>
        {file && sourceColumns.length > 0 && (
          <details
            className="mb-6 rounded-lg border border-white/10 p-4"
            open={!!importError && validatedRows.length === 0}
          >
            <summary className="cursor-pointer text-sm font-medium">
              Match columns from your file
            </summary>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              Choose what each column contains. Unmatched columns are skipped.
              Map a name (or first name) and an email or payment address.
            </p>
            <div className="mt-4 max-h-80 space-y-4 overflow-auto">
              {sourceColumns.map((column, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium">
                      {column || `Column ${index + 1}`}
                    </p>
                    <p
                      className="truncate text-xs text-slate-400"
                      title={sample[index]}
                    >
                      {sample[index] || "No sample value"}
                    </p>
                  </div>
                  <label>
                    <span className="sr-only">
                      Map column {index + 1}: {column}
                    </span>
                    <select
                      className="finance-field"
                      value={
                        importFields.some(([field]) => field === mapping[index])
                          ? mapping[index]
                          : ""
                      }
                      onChange={(e) => {
                        setMapping((previous) =>
                          previous.map((value, i) =>
                            i === index ? e.target.value : value,
                          ),
                        );
                        setMappingDirty(true);
                      }}
                    >
                      <option value="">Skip this column</option>
                      {importFields.map(([field, label]) => (
                        <option key={field} value={field}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
            <Button
              className="mt-4"
              size="sm"
              variant="secondary"
              disabled={parsing || isImporting}
              onClick={() => {
                void handleFileSelect(
                  file,
                  mapping.map((value) =>
                    importFields.some(([field]) => field === value)
                      ? value
                      : "",
                  ),
                );
              }}
            >
              Apply column mapping
            </Button>
            {mappingDirty && (
              <p
                role="status"
                className="mt-2 text-xs workspace-funding-warning"
              >
                Apply your column changes before importing.
              </p>
            )}
          </details>
        )}

        {/* Step 2: File Upload */}
        <div className="mb-6">
          {!file ? (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="rounded-lg border-2 border-dashed border-white/20 bg-navy-800/30 p-8 text-center hover:border-accent-500/50 transition-colors"
            >
              <Upload className="h-10 w-10 text-slate-400 mx-auto mb-3" />
              <p className="text-sm text-slate-300 mb-1">
                {t("beneficiaries.bulkImport.upload.dropText")}
              </p>
              <p className="text-xs text-slate-500 mb-4">
                {t("beneficiaries.bulkImport.upload.hint")}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv"
                className="hidden"
                onChange={(e) => {
                  const selectedFile = e.target.files?.[0];
                  if (selectedFile) {
                    handleFileSelect(selectedFile);
                  }
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                {t("beneficiaries.bulkImport.upload.chooseFile")}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-navy-800/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-accent-400" />
                  <div>
                    <p className="text-sm font-medium text-white">
                      {file.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {(file.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                </div>
                {parsing ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("beneficiaries.bulkImport.upload.parsing")}
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFile(null);
                      setValidatedRows([]);
                      setImportError(null);
                    }}
                    className="h-9"
                  >
                    {t("beneficiaries.bulkImport.upload.replace")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {!file && (
          <div className="mb-6">
            <label className="finance-label" htmlFor="paste-recipients">
              Or paste spreadsheet rows, including column headings
            </label>
            <textarea
              id="paste-recipients"
              className="finance-field min-h-28"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={
                "First name\tLast name\tEmail\nJamie\tChen\tjamie@example.com"
              }
            />
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              disabled={!paste.trim() || parsing}
              onClick={() =>
                handleFileSelect(
                  new File([paste], "pasted-recipients.csv", {
                    type: "text/csv",
                  }),
                )
              }
            >
              Preview recipients
            </Button>
          </div>
        )}
        {validatedRows.some((row) => row.isValid && !row.wallet_address) && (
          <p className="mb-4 rounded-lg bg-amber-500/10 p-3 text-sm workspace-funding-warning">
            Recipients without payment details will be saved to your directory.
            Complete and review their details before payment.
          </p>
        )}

        {/* Step 3: Preview & Validation */}
        {validatedRows.length > 0 && (
          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">
                {t("beneficiaries.bulkImport.preview.title")}
              </h3>
              <p className="text-xs text-slate-400">
                {t("beneficiaries.bulkImport.preview.selected", {
                  count: validSelectedCount,
                  total: validatedRows.length,
                })}
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-navy-800/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="recipient-import-table w-full" role="table">
                  <thead>
                    <tr className="border-b border-white/10 bg-navy-900/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 w-12">
                        <input
                          type="checkbox"
                          aria-label="Select all valid recipients"
                          checked={validatedRows.every(
                            (r, index) => !selectable(index) || r.isSelected,
                          )}
                          onChange={(e) => {
                            setValidatedRows((prev) =>
                              prev.map((row, index) => ({
                                ...row,
                                isSelected: selectable(index)
                                  ? e.target.checked
                                  : false,
                              })),
                            );
                          }}
                          className="rounded border-white/20"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
                        {t("beneficiaries.bulkImport.preview.type")}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
                        {t("beneficiaries.bulkImport.preview.name")}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
                        {t("beneficiaries.bulkImport.preview.walletAddress")}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
                        Email & notes
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
                        {t("beneficiaries.bulkImport.preview.status")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {validatedRows.map((row, index) => (
                      <Fragment key={row.rowIndex}>
                        <tr
                          role="row"
                          className={cn(
                            "hover:bg-navy-800/30",
                            !row.isValid && "bg-red-500/5",
                            row.isSelected && row.isValid && "bg-accent-500/5",
                          )}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Import ${row.name || `row ${row.rowIndex + 1}`}`}
                              checked={row.isSelected && selectable(index)}
                              onChange={() => toggleRowSelection(row.rowIndex)}
                              disabled={!selectable(index)}
                              className="rounded border-white/20 disabled:opacity-50"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-white capitalize">
                            {row.type}
                          </td>
                          <td className="px-4 py-3 text-sm text-white">
                            <span className="font-medium">{row.name}</span>
                            {row.source_id && (
                              <p className="mt-1 text-xs text-slate-400">
                                {row.source_system || sourceSystem} ·{" "}
                                {row.source_id}
                              </p>
                            )}
                            {!!plans[index].differences.length && (
                              <button
                                type="button"
                                aria-expanded={expandedRows.has(row.rowIndex)}
                                aria-controls={`import-changes-${row.rowIndex}`}
                                className="mt-2 block text-left text-xs text-accent-400"
                                onClick={() =>
                                  setExpandedRows((previous) => {
                                    const next = new Set(previous);
                                    if (next.has(row.rowIndex))
                                      next.delete(row.rowIndex);
                                    else next.add(row.rowIndex);
                                    return next;
                                  })
                                }
                              >
                                Review {plans[index].differences.length} change
                                {plans[index].differences.length === 1
                                  ? ""
                                  : "s"}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <code className="text-xs text-slate-400 font-mono">
                              {row.wallet_address
                                ? `${row.wallet_address.slice(0, 6)}…${row.wallet_address.slice(-4)}`
                                : plans[index].existingId
                                  ? "Keep saved payout details"
                                  : "Payment details needed"}
                            </code>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-400">
                            <p>{row.email || "-"}</p>
                            {row.notes && (
                              <p className="mt-1 text-xs">{row.notes}</p>
                            )}
                            {(row.preferred_token || row.preferred_network) && (
                              <p className="mt-1 text-xs">
                                Payout:{" "}
                                {row.preferred_token || "Currency not set"} ·{" "}
                                {row.preferred_network || "Network not set"}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {row.isValid && !plans[index].errors.length ? (
                              <div className="flex items-center gap-1 text-green-400">
                                <CheckCircle2 className="h-4 w-4" />
                                <span className="text-xs">
                                  {!row.isSelected ||
                                  plans[index].recommendation === "skip"
                                    ? "Skip"
                                    : plans[index].recommendation === "update"
                                      ? "Update existing"
                                      : "Create recipient"}
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {[...row.errors, ...plans[index].errors].map(
                                  (error, idx) => (
                                    <div
                                      key={idx}
                                      className="flex items-start gap-1 text-red-400"
                                    >
                                      <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                                      <span className="text-xs">{error}</span>
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                        <tr
                          className="recipient-import-changes"
                          hidden={!expandedRows.has(row.rowIndex)}
                          id={`import-changes-${row.rowIndex}`}
                        >
                          <td colSpan={6} className="px-4 py-4">
                            <div
                              role="region"
                              aria-label={`Changes for ${row.name}`}
                            >
                              <dl className="grid gap-5 text-xs sm:grid-cols-2">
                                {plans[index].differences.map((d) => (
                                  <div
                                    key={d.field}
                                    className={
                                      d.field === "walletAddress"
                                        ? "sm:col-span-2"
                                        : ""
                                    }
                                  >
                                    <dt className="font-semibold">
                                      {d.label}
                                      {d.payout
                                        ? " · Payout review required"
                                        : ""}
                                    </dt>
                                    <dd className="mt-1 break-all text-slate-400">
                                      Saved: {d.before || "Not set"}
                                    </dd>
                                    <dd className="mt-1 break-all">
                                      Imported: {d.after || "Not set"}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Import Action */}
        {validatedRows.length > 0 && (
          <div className="sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center justify-end gap-3 border-t border-white/10 bg-navy-950 px-6 py-4">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={!canDismiss}
              className="h-11"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleImport}
              disabled={
                validSelectedCount === 0 ||
                mappingDirty ||
                isImporting ||
                !canDismiss ||
                !existingBeneficiaries ||
                !sessionToken
              }
              className="h-11"
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("beneficiaries.bulkImport.importing")}
                </>
              ) : (
                `Apply ${validSelectedCount} change${validSelectedCount === 1 ? "" : "s"}`
              )}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
import { parsePayoutNetwork } from "../../../shared/payoutInstructions";
