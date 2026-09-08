import { userErrorMessage } from '@/lib/userErrors';
import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { Dialog } from '@/components/ui/Dialog';
import { Notice, LoadingRows } from '@/components/workspace/WorkspacePrimitives';
import { useSessionToken } from '@/lib/session';
import { exportToCsv } from '@/lib/csv';
import { JournalPreview } from './JournalPreview';
export function AccountingExport({ exportId, canReview, onClose }: { exportId: Id<'accountingExports'>; canReview: boolean; onClose: () => void }) {
  const sessionToken = useSessionToken();
  const data = useQuery(api.accounting.exportDetails, sessionToken ? { exportId, sessionToken } : 'skip');
  const confirm = useMutation(api.accounting.confirmImport);
  const [reference, setReference] = useState(''), [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Dialog title="Journal export" onClose={onClose}><div className="space-y-5 p-5 sm:p-6">
    {!data ? <LoadingRows /> : <>
      <p className="text-sm">{data.entries.length} journal{data.entries.length === 1 ? '' : 's'} · {data.batch.currency} · {data.batch.environment === 'test' ? 'Test activity' : 'Business activity'}</p>
      <p className="text-sm text-slate-400">Import once into your accounting system, then confirm below. Downloads retain the original journal numbers and reviewed account names.</p>
      <div className="flex flex-wrap gap-3">
        <button className="workspace-button workspace-button-primary" onClick={() => exportToCsv(`disburse_journals_${exportId}`,
          data.entries.flatMap(entry => entry.lines.map(line => ({
            JournalNo: entry.journalNumber, JournalDate: entry.postingDate, AccountName: line.account.name,
            Description: entry.memo, Debits: line.debit, Credits: line.credit, Name: line.name ?? '',
          }))), [
            { key: 'JournalNo', label: 'Journal No.' }, { key: 'JournalDate', label: 'Journal Date' },
            { key: 'AccountName', label: 'Account Name' }, { key: 'Description', label: 'Journal/Description' },
            { key: 'Debits', label: 'Debits' }, { key: 'Credits', label: 'Credits' }, { key: 'Name', label: 'Name' },
          ])}>Download journal CSV</button>
        <button className="workspace-button" onClick={() => {
          const rows = data.entries.flatMap(entry => entry.lines.map((line, index) => ({
            journal_id: entry._id, journal_number: entry.journalNumber, line_id: `${entry._id}:${index + 1}`,
            movement_id: entry.fact.key, posting_date: entry.postingDate, functional_currency: entry.currency,
            account_id: line.account.externalId, account_name: line.account.name, mapping_version: line.account.version,
            debit: line.debit, credit: line.credit, external_name: line.name ?? '', book_reference: entry.bookReference,
            treatment: entry.treatment, reversal_of: entry.reversalOf ?? '', replaces: entry.replaces ?? '',
            asset_quantity: entry.fact.nonCash ? '' : entry.fact.amount, document_quantity: entry.fact.nonCash ? entry.fact.amount : '', raw_units: entry.fact.amountRaw, token: entry.fact.token, token_contract: entry.fact.tokenAddress,
            network_id: entry.fact.chainId, account_address: entry.fact.accountAddress, counterparty_address: entry.fact.counterpartyAddress,
            transaction_hash: entry.fact.txHash ?? '', transfer_id: entry.fact.transferId ?? '', settled_utc: entry.fact.nonCash ? '' : new Date(entry.fact.settledAt).toISOString(),
            document_issued_utc: entry.fact.nonCash ? new Date(entry.fact.settledAt).toISOString() : '',
            settlement_block: entry.fact.blockNumber, block_hash: entry.fact.blockHash ?? '', date_evidence: entry.fact.dateSource,
            valuation_evidence: entry.valuationEvidence, source_documents: entry.fact.references.map(ref => `${ref.kind}:${ref.id}:${ref.number}`).join(' | '),
            company_transfer_id: entry.fact.treasuryTransferId ?? '', delivery_fee_raw_usdc: entry.fact.deliveryFeeRaw ?? '', delivery_fee_book_value: entry.deliveryFeeBookValue ?? '',
          })));
          exportToCsv(`disburse_reconciliation_${exportId}`, rows, Object.keys(rows[0] ?? {}).map(key => ({ key, label: key })));
        }}>Download reconciliation evidence</button>
      </div>
      <p className="text-xs text-slate-400">The journal CSV uses the fields supported by QuickBooks journal import. Map the date format and existing accounts in the importer. Reconciliation evidence repeats the movement reference on each journal line; asset quantities and delivery-fee evidence are not additive across lines or corrections.</p>
      {data.entries.map(entry => <details key={entry._id} className="space-y-3 rounded-xl border border-white/10 p-4">
        <summary className="cursor-pointer text-sm font-medium">{entry.journalNumber} · {entry.postingDate} · {entry.memo}</summary>
        <JournalPreview lines={entry.lines} currency={entry.currency} />
      </details>)}
      {data.batch.importedAt ? <Notice tone="info">Import confirmed: {data.batch.importedReference}</Notice>
        : canReview && <form className="space-y-4 border-t border-white/10 pt-4" onSubmit={async e => {
          e.preventDefault(); if (!sessionToken || !checked || busy) return; setBusy(true); setError('');
          try { await confirm({ exportId, sessionToken, reference }); }
          catch (e) { setError(userErrorMessage(e, 'Could not confirm the import')); } finally { setBusy(false); }
        }}>
          {error && <Notice>{error}</Notice>}
          <label className="block"><span className="finance-label">Import reference in your books</span><input className="finance-field" value={reference} onChange={e => setReference(e.target.value)} maxLength={200} required /></label>
          <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
            <span>I verified that every journal in this export was imported once and matches the amounts in our books.</span></label>
          <button className="workspace-button workspace-button-primary" disabled={!checked || busy}>{busy ? 'Confirming…' : 'Confirm import'}</button>
        </form>}
    </>}
  </div></Dialog>;
}
