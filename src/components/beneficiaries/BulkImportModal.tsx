import { useState, useCallback, useMemo, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Id } from '../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { X, Download, Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { parseCsvFile, validateCsvRow, generateCsvTemplate, type CsvRow } from '@/lib/csv';
import { isValidEthereumAddress } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface BulkImportModalProps {
  orgId: Id<'orgs'>;
  onClose: () => void;
  onSuccess: () => void;
}

interface ValidatedRow extends CsvRow {
  rowIndex: number;
  isValid: boolean;
  errors: string[];
  isSelected: boolean;
}

export function BulkImportModal({ orgId, onClose, onSuccess }: BulkImportModalProps) {
  const { address } = useAccount();
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [validatedRows, setValidatedRows] = useState<ValidatedRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get existing beneficiaries to check for duplicates
  const existingBeneficiaries = useQuery(
    api.beneficiaries.list,
    orgId && address
      ? { orgId, walletAddress: address }
      : 'skip'
  );

  const createBulk = useMutation(api.beneficiaries.createBulk);

  // Create set of existing addresses
  const existingAddresses = useMemo(() => {
    if (!existingBeneficiaries) return new Set<string>();
    return new Set(
      existingBeneficiaries.map((b) => b.walletAddress.toLowerCase())
    );
  }, [existingBeneficiaries]);

  // Download template
  const handleDownloadTemplate = useCallback(() => {
    const template = generateCsvTemplate();
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'beneficiary_import_template.csv';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback(async (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.csv')) {
      setImportError(t('beneficiaries.bulkImport.errors.invalidFileType'));
      return;
    }

    // Check file size (5MB limit)
    if (selectedFile.size > 5 * 1024 * 1024) {
      setImportError(t('beneficiaries.bulkImport.errors.fileTooLarge'));
      return;
    }

    setFile(selectedFile);
    setImportError(null);
    setParsing(true);

    try {
      const rows = await parseCsvFile(selectedFile);
      
      if (rows.length === 0) {
        setImportError(t('beneficiaries.bulkImport.errors.noData'));
        setParsing(false);
        return;
      }

      // Validate each row
      const csvAddresses = new Map<string, number>();
      const validated: ValidatedRow[] = rows.map((row, index) => {
        // Additional validation with viem
        const validation = validateCsvRow(row, index, existingAddresses, csvAddresses);
        
        // Double-check wallet address with viem
        if (validation.isValid && row.wallet_address) {
          if (!isValidEthereumAddress(row.wallet_address.trim())) {
            validation.isValid = false;
            validation.errors.push(t('beneficiaries.bulkImport.errors.invalidAddress'));
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
      console.error('Failed to parse CSV:', error);
      setImportError(
        error instanceof Error
          ? error.message
          : t('beneficiaries.bulkImport.errors.parseError')
      );
    } finally {
      setParsing(false);
    }
  }, [existingAddresses, t]);

  // Handle drag and drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        handleFileSelect(droppedFile);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Toggle row selection
  const toggleRowSelection = useCallback((rowIndex: number) => {
    setValidatedRows((prev) =>
      prev.map((row) =>
        row.rowIndex === rowIndex ? { ...row, isSelected: !row.isSelected } : row
      )
    );
  }, []);

  // Handle import
  const handleImport = useCallback(async () => {
    if (!address) return;

    const selectedRows = validatedRows.filter((r) => r.isSelected && r.isValid);
    if (selectedRows.length === 0) {
      setImportError(t('beneficiaries.bulkImport.errors.noRowsSelected'));
      return;
    }

    setIsImporting(true);
    setImportError(null);

    try {
      await createBulk({
        orgId,
        walletAddress: address,
        beneficiaries: selectedRows.map((row) => ({
          type: row.type.trim().toLowerCase() as 'individual' | 'business',
          name: row.name.trim(),
          beneficiaryAddress: row.wallet_address.trim(),
          notes: row.notes?.trim() || undefined,
        })),
      });

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Failed to import beneficiaries:', error);
      setImportError(
        error instanceof Error
          ? error.message
          : t('beneficiaries.bulkImport.errors.importError')
      );
    } finally {
      setIsImporting(false);
    }
  }, [address, validatedRows, orgId, createBulk, onSuccess, onClose, t]);

  const validSelectedCount = validatedRows.filter((r) => r.isSelected && r.isValid).length;
  const canDismiss = !parsing && !isImporting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
      onClick={canDismiss ? onClose : undefined}
    >
      <div
        className={cn(
          "rounded-2xl border border-white/10 bg-navy-900 p-6 w-full max-w-4xl my-auto",
          "max-h-[90vh] overflow-y-auto"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">
            {t('beneficiaries.bulkImport.title')}
          </h2>
          {canDismiss && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Error Message */}
        {importError && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{importError}</span>
          </div>
        )}

        {/* Step 1: Template Download */}
        <div className="mb-6">
          <div className="rounded-lg border border-white/10 bg-navy-800/50 p-4">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-accent-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-white mb-1">
                  {t('beneficiaries.bulkImport.template.title')}
                </h3>
                <p className="text-sm text-slate-400 mb-3">
                  {t('beneficiaries.bulkImport.template.description')}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDownloadTemplate}
                  className="h-9"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {t('beneficiaries.bulkImport.template.download')}
                </Button>
              </div>
            </div>
          </div>
        </div>

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
                {t('beneficiaries.bulkImport.upload.dropText')}
              </p>
              <p className="text-xs text-slate-500 mb-4">
                {t('beneficiaries.bulkImport.upload.hint')}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
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
                {t('beneficiaries.bulkImport.upload.chooseFile')}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-navy-800/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-accent-400" />
                  <div>
                    <p className="text-sm font-medium text-white">{file.name}</p>
                    <p className="text-xs text-slate-400">
                      {(file.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                </div>
                {parsing ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('beneficiaries.bulkImport.upload.parsing')}
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
                    {t('beneficiaries.bulkImport.upload.replace')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Step 3: Preview & Validation */}
        {validatedRows.length > 0 && (
          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">
                {t('beneficiaries.bulkImport.preview.title')}
              </h3>
              <p className="text-xs text-slate-400">
                {t('beneficiaries.bulkImport.preview.selected', {
                  count: validSelectedCount,
                  total: validatedRows.length,
                })}
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-navy-800/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10 bg-navy-900/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 w-12">
                        <input
                          type="checkbox"
                          checked={validatedRows.every((r) => !r.isValid || r.isSelected)}
                          onChange={(e) => {
                            setValidatedRows((prev) =>
                              prev.map((row) => ({
                                ...row,
                                isSelected: row.isValid ? e.target.checked : false,
                              }))
                            );
                          }}
                          className="rounded border-white/20"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
                        {t('beneficiaries.bulkImport.preview.type')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
                        {t('beneficiaries.bulkImport.preview.name')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
                        {t('beneficiaries.bulkImport.preview.walletAddress')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
                        {t('beneficiaries.bulkImport.preview.notes')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
                        {t('beneficiaries.bulkImport.preview.status')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {validatedRows.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={cn(
                          'hover:bg-navy-800/30',
                          !row.isValid && 'bg-red-500/5',
                          row.isSelected && row.isValid && 'bg-accent-500/5'
                        )}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={row.isSelected}
                            onChange={() => toggleRowSelection(row.rowIndex)}
                            disabled={!row.isValid}
                            className="rounded border-white/20 disabled:opacity-50"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-white capitalize">
                          {row.type}
                        </td>
                        <td className="px-4 py-3 text-sm text-white">{row.name}</td>
                        <td className="px-4 py-3">
                          <code className="text-xs text-slate-400 font-mono">
                            {row.wallet_address.slice(0, 6)}...{row.wallet_address.slice(-4)}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-400">
                          {row.notes || '-'}
                        </td>
                        <td className="px-4 py-3">
                          {row.isValid ? (
                            <div className="flex items-center gap-1 text-green-400">
                              <CheckCircle2 className="h-4 w-4" />
                              <span className="text-xs">{t('common.valid')}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {row.errors.map((error, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-start gap-1 text-red-400"
                                >
                                  <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                                  <span className="text-xs">{error}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Import Action */}
        {validatedRows.length > 0 && (
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={!canDismiss}
              className="h-11"
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleImport}
              disabled={validSelectedCount === 0 || isImporting || !canDismiss}
              className="h-11"
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('beneficiaries.bulkImport.importing')}
                </>
              ) : (
                t(`beneficiaries.bulkImport.addBeneficiaries_${validSelectedCount === 1 ? 'one' : 'other'}`, {
                  count: validSelectedCount,
                })
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
