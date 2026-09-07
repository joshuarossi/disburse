import { userErrorMessage } from '@/lib/userErrors';
import { useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { AccountingSource } from '../../../convex/lib/accountingSource';
import { accountingTreatments } from '../../../shared/accounting';
import { useSessionToken } from '@/lib/session';
import { useActivityEnvironment } from '@/features/workspace/ActivityEnvironment';
import { AccountingReview } from '@/features/accounting/AccountingReview';
import { AccountingSettings } from '@/features/accounting/AccountingSettings';
import { AccountingExport } from '@/features/accounting/AccountingExport';
import { AccountBalanceReview } from '@/features/accounting/AccountBalanceReview';
import { EmptyState, LoadingRows, Notice } from '@/components/workspace/WorkspacePrimitives';
import { useReportPages } from './useReportPages';
import { BookOpen } from 'lucide-react';

export function AccountingTab({ orgId }: { orgId?: string }) {
  const { environment } = useActivityEnvironment();
  return <AccountingWorkspace key={`${orgId}:${environment}`} orgId={orgId} environment={environment} />;
}
function AccountingWorkspace({ orgId, environment }: { orgId?: string; environment: 'production' | 'test' | 'unclassified' }) {
  const sessionToken = useSessionToken();
  const access = orgId && sessionToken ? { orgId: orgId as Id<'orgs'>, sessionToken } : null;
  const scope = access && environment !== 'unclassified' ? { ...access, environment } : null;
  const config = useQuery(api.accounting.configuration, access ?? 'skip');
  const [view, setView] = useState<'activity' | 'receipts' | 'journals' | 'exports' | 'balances'>('activity');
  const [settings, setSettings] = useState(false), [source, setSource] = useState<AccountingSource | null>(null);
  const [exportId, setExportId] = useState<Id<'accountingExports'> | null>(null);
  const [selected, setSelected] = useState<Id<'accountingEntries'>[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const createExport = useMutation(api.accounting.createExport);
  const request = useRef<{ key: string; id: string } | null>(null);
  const pages = useReportPages({ orgId, environment, view });
  const activity = useQuery(api.reports.getTransactionReport, scope && view === 'activity' ? { ...scope, pageSize: 50, cursor: pages.cursor } : 'skip');
  const receipts = useQuery(api.accounting.listReceipts, scope && view === 'receipts' ? { ...scope, cursor: pages.cursor } : 'skip');
  const journals = useQuery(api.accounting.listEntries, scope && view === 'journals' ? { ...scope, cursor: pages.cursor } : 'skip');
  const exports = useQuery(api.accounting.listExports, scope && view === 'exports' ? { ...scope, cursor: pages.cursor } : 'skip');
  const page = view === 'activity' ? activity : view === 'receipts' ? receipts : view === 'journals' ? journals : exports;
  const chooseExport = async () => {
    if (!scope || !selected.length || busy) return;
    setBusy(true); setError('');
    const key = `${orgId}:${environment}:${[...selected].sort().join(',')}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try { setExportId(await createExport({ ...scope, entryIds: selected, requestId: request.current.id })); setSelected([]); request.current = null; }
    catch (e) { setError(userErrorMessage(e, 'Could not prepare this export')); }
    finally { setBusy(false); }
  };
  const activityRows = activity?.items ?? [];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-lg font-semibold">Reconciliation</h2>
        <p className="mt-1 text-sm text-slate-400">{config?.profile ? `${config.profile.bookName} · Functional currency ${config.profile.currency}` : 'Match settled movements to your existing accounting books.'}</p></div>
      {config?.canConfigure && <button className="workspace-button" onClick={() => setSettings(true)}>{config.profile ? 'Book and account settings' : 'Set up accounting'}</button>}
    </div>
    {view !== 'balances' && <p className="text-sm leading-6 text-slate-400">Review each movement, connect its book reference, and prepare a balanced journal only when an entry is needed. Customer collections and transfers between company accounts keep their own treatment.</p>}
    {environment === 'unclassified' && <Notice tone="info">Choose Business activity or Test activity to reconcile verified asset movements.</Notice>}
    {config && !config.profile && <Notice tone="info">Set up the functional currency and import your chart of accounts before preparing journals.</Notice>}
    {error && <Notice>{error}</Notice>}
    <div className="workspace-tabs" aria-label="Reconciliation sections">
      {Object.entries({ activity: 'Account activity', receipts: 'Invoice receipts', journals: 'Journals', exports: 'Exports', balances: 'Balance checks' }).map(([key, label]) =>
        <button key={key} aria-pressed={view === key} onClick={() => { setView(key as typeof view); setSelected([]); setError(''); }}>{label}</button>)}
    </div>
    {scope && (view === 'balances' ? <AccountBalanceReview orgId={scope.orgId} environment={scope.environment} canReview={!!config?.canReview} /> : !page ? <LoadingRows /> : <>
      {view === 'activity' && <section className="workspace-panel">
        {activity?.indexing && <Notice tone="info">Account history is still being indexed. Refresh Transactions to check the full coverage.</Notice>}
        {!activityRows.length ? <EmptyState icon={BookOpen} title="No movements on this page" description={activity?.isDone === false ? 'Continue to the next page to review more history.' : 'Settled account activity appears here after history has been refreshed.'} />
          : <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Settled activity</th><th>Account</th><th className="numeric">Quantity</th><th>Reconciliation</th></tr></thead>
            <tbody>{activityRows.map(row => <tr key={row.rowId}><td><span className="block font-medium">{row.beneficiaryName}</span>
              <span className="workspace-table-secondary">{new Date(row.createdAt).toISOString().slice(0, 10)} · {row.network} · {row.direction === 'inflow' ? 'Received' : 'Sent'}</span></td>
              <td className="font-mono text-xs">{row.accountAddress.slice(0, 8)}…{row.accountAddress.slice(-6)}</td>
              <td className="numeric">{row.amount} {row.token}</td>
              <td><button className="workspace-action-link" onClick={() => setSource({ kind: 'activity', id: row.rowId })}>{row.includedInTotals ? 'Review with books' : 'Check evidence'}</button></td></tr>)}</tbody>
          </table></div>}
      </section>}
      {view === 'receipts' && <section className="workspace-panel">
        <p className="p-4 text-sm text-slate-400">Original customer receipts and forwarding transfers are shown separately. A receiving address and your main account can reference the same forwarding movement; it is reconciled once.</p>
        {!receipts?.page.length ? <EmptyState icon={BookOpen} title="No invoice receipts on this page" description="Confirmed invoice receipts appear here, including funds still awaiting forwarding." />
          : <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Invoice movement</th><th>Date · UTC</th><th className="numeric">Quantity</th><th>Review</th></tr></thead>
            <tbody>{receipts.page.map(row => <tr key={row.id}><td><span className="block font-medium">{row.label}</span>
              <span className="workspace-table-secondary">{row.companyTransfer ? 'Internal transfer' : 'Customer receipt'}{row.error ? ` · ${row.error}` : ''}</span></td>
              <td>{new Date(row.settledAt).toISOString().slice(0, 10)}</td><td className="numeric">{row.amount || 'Check evidence'} {row.token}</td>
              <td><button className="workspace-action-link" onClick={() => setSource({ kind: 'receipt', id: row.id })}>{row.state ? 'View reconciliation' : 'Review with books'}</button></td></tr>)}</tbody>
          </table></div>}
      </section>}
      {view === 'journals' && <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-400">Choose reviewed journals to export. Include both parts of a correction.</p>
          {config?.canReview && <button className="workspace-button workspace-button-primary" disabled={!selected.length || busy} onClick={() => void chooseExport()}>
            {busy ? 'Preparing export…' : `Prepare export${selected.length ? ` · ${selected.length}` : ''}`}</button>}
        </div>
        <section className="workspace-panel">{!journals?.page.length ? <EmptyState icon={BookOpen} title="No reviewed journals yet" description="Review account activity or an invoice receipt to prepare its accounting entry." />
          : <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th><span className="sr-only">Select journal</span></th><th>Journal</th><th>Accounting date</th><th>Book value</th><th>Status</th></tr></thead>
            <tbody>{journals.page.map(entry => <tr key={entry._id}><td>{entry.state === 'ready' && config?.canReview && <input type="checkbox"
              aria-label={`Export ${entry.journalNumber}`} checked={selected.includes(entry._id)}
              onChange={e => setSelected(old => e.target.checked ? [...old, entry._id] : old.filter(id => id !== entry._id))} />}</td>
              <td><span className="block font-medium">{entry.journalNumber}</span>
                <span className="workspace-table-secondary">{entry.reversalOf ? 'Reversal' : accountingTreatments[entry.treatment]}</span></td>
              <td>{entry.postingDate}</td><td className="numeric">{entry.assetBookValue} {entry.currency}</td>
              <td>{entry.state === 'ready' ? 'Ready to export' : entry.state === 'exported' ? 'Awaiting import' : entry.state === 'void' ? 'Replaced before export' : 'Reconciled'}
                <button className="workspace-action-link block mt-1" onClick={() => setSource(entry.fact.source)}>Review movement</button>
                {entry.exportId && <button className="workspace-action-link block mt-1" onClick={() => setExportId(entry.exportId!)}>Open original export</button>}</td></tr>)}</tbody>
          </table></div>}</section>
      </>}
      {view === 'exports' && <section className="workspace-panel">{!exports?.page.length ? <EmptyState icon={BookOpen} title="No journal exports yet" description="Prepare an export from the Journals tab. Existing exports can be downloaded again without creating new journal numbers." />
        : <ul className="divide-y divide-white/10">{exports.page.map(batch => <li key={batch._id} className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div><p className="font-medium">{batch.entryIds.length} journals · {batch.currency}</p><p className="text-sm text-slate-400">{new Date(batch.createdAt).toLocaleString()} · {batch.importedAt ? 'Import confirmed' : 'Awaiting import confirmation'}</p></div>
          <button className="workspace-button" onClick={() => setExportId(batch._id)}>Open export</button></li>)}</ul>}</section>}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>Page {pages.page}</span><div className="flex gap-3">
        <button className="workspace-button" disabled={pages.page < 2} onClick={() => { pages.previous(); setSelected([]); }}>Previous</button>
        <button className="workspace-button" disabled={page.isDone} onClick={() => { pages.next(page.continueCursor); setSelected([]); }}>Next</button>
      </div></div>
    </>)}
    {settings && config && orgId && <AccountingSettings orgId={orgId as Id<'orgs'>} config={config} onClose={() => setSettings(false)} />}
    {source && orgId && <AccountingReview key={`${source.kind}:${source.id}`} orgId={orgId as Id<'orgs'>} source={source} onClose={() => setSource(null)} />}
    {exportId && <AccountingExport key={exportId} exportId={exportId} canReview={!!config?.canReview} onClose={() => setExportId(null)} />}
  </div>;
}
