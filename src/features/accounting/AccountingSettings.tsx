import { userErrorMessage } from '@/lib/userErrors';
import { useState } from 'react';
import { useMutation } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { BOOK_CURRENCIES, type AccountKind, type BookCurrency } from '../../../shared/accounting';
import { useSessionToken } from '@/lib/session';
import { Dialog } from '@/components/ui/Dialog';
import { Notice } from '@/components/workspace/WorkspacePrimitives';
import { exportToCsv, parseCsvRecords } from '@/lib/csv';

export function AccountingSettings({ orgId, config, onClose }: {
  orgId: Id<'orgs'>; config: FunctionReturnType<typeof api.accounting.configuration>; onClose: () => void;
}) {
  const sessionToken = useSessionToken();
  const save = useMutation(api.accounting.configure), importAccounts = useMutation(api.accounting.importAccounts);
  const [name, setName] = useState(config.profile?.bookName ?? '');
  const [currency, setCurrency] = useState<BookCurrency>(config.profile?.currency ?? 'USD');
  const [closed, setClosed] = useState(config.profile?.closedThrough ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [rows, setRows] = useState<Array<{ externalId: string; name: string; kind: AccountKind; active: boolean }>>([]);
  const [importVersion, setImportVersion] = useState(0);
  const kinds: AccountKind[] = ['asset', 'payable', 'receivable', 'liability', 'equity', 'income', 'expense'];
  const reopening = !!config.profile?.closedThrough && (!closed || closed < config.profile.closedThrough);
  return <Dialog title="Accounting book and accounts" onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-6 p-5 sm:p-6">
      <p className="text-sm text-slate-400">Use the functional currency, exact account names and identifiers from your existing books. Your accounting system remains the book of record.</p>
      {error && <Notice>{error}</Notice>}{success && <p role="status" className="text-sm">{success}</p>}
      <form className="space-y-4" onSubmit={async e => {
        e.preventDefault(); if (!sessionToken || busy) return; setBusy(true); setError(''); setSuccess('');
        try { await save({ orgId, sessionToken, currency, bookName: name, closedThrough: closed || undefined,
          expectedVersion: config.profile?.version ?? 0, reopenReason: reopening ? reason : undefined }); setSuccess('Accounting settings saved.'); }
        catch (e) { setError(userErrorMessage(e, 'Could not save accounting settings')); } finally { setBusy(false); }
      }}>
        <label className="block"><span className="finance-label">Book name</span><input className="finance-field" value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="e.g. Northstar · QuickBooks" required /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className="finance-label">Functional currency</span><select className="finance-field" value={currency} onChange={e => setCurrency(e.target.value as BookCurrency)}
            disabled={(config.profile?.nextJournal ?? 1) > 1}>{Object.keys(BOOK_CURRENCIES).map(code => <option key={code}>{code}</option>)}</select></label>
          <label><span className="finance-label">Books closed through</span><input className="finance-field" type="date" value={closed} onChange={e => setClosed(e.target.value)} /></label>
        </div>
        <p className="text-xs text-slate-400">Close a period after matching its activity and confirming journal imports. Reopening requires an admin and a recorded reason.</p>
        {reopening && <label className="block"><span className="finance-label">Reason for reopening</span><textarea className="finance-field" value={reason} onChange={e => setReason(e.target.value)} minLength={10} maxLength={500} required /></label>}
        <button className="workspace-button workspace-button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save book settings'}</button>
      </form>
      {config.profile && <section className="space-y-4 border-t border-white/10 pt-5">
        <div><h3 className="font-semibold">Chart of accounts</h3><p className="mt-1 text-sm text-slate-400">{config.accounts.filter(a => a.active).length} active accounts. Reimporting an ID updates its mapping; existing journal exports retain their original names.</p></div>
        <button className="workspace-button" onClick={() => exportToCsv('chart_of_accounts_template', [
          { account_id: '0010', account_name: 'Digital assets:Operations', account_type: 'asset', active: 'true' },
          { account_id: '2100', account_name: 'Accounts Payable', account_type: 'payable', active: 'true' },
        ], ['account_id', 'account_name', 'account_type', 'active'].map(key => ({ key, label: key })))}>Download CSV template</button>
        <p className="text-xs leading-5 text-slate-400">Use account_id, account_name, account_type and active columns. Account types: {kinds.join(', ')}. Preserve your book's full parent:subaccount names. The template is an example to replace with your own accounts.</p>
        <label className="block"><span className="finance-label">Import chart CSV</span>
          <input className="finance-field" type="file" accept=".csv,text/csv" disabled={busy} onChange={async e => {
            const file = e.target.files?.[0]; if (!file) return; setError(''); setRows([]); setSuccess('');
            try {
              if (file.size > 1024 * 1024) throw new Error('Choose a CSV smaller than 1 MB');
              const [header, ...data] = parseCsvRecords(await file.text());
              const keys = ['account_id', 'account_name', 'account_type', 'active'];
              if (!header || keys.some(key => header.filter(h => h.toLowerCase() === key).length !== 1)) throw new Error('Use the four column headers from the CSV template');
              if (!data.length || data.length > 500) throw new Error('Import between 1 and 500 accounts at a time');
              const indices = keys.map(key => header.findIndex(h => h.toLowerCase() === key));
              const preview = data.map((row, i) => {
                if (row.length !== header.length) throw new Error(`Row ${i + 2} has missing or extra columns`);
                const [externalId, name, kind, enabled] = indices.map(index => row[index]);
                if (!externalId || !name || !kinds.includes(kind as AccountKind) || !['true', 'false'].includes(enabled.toLowerCase()))
                  throw new Error(`Review the account ID, name, type and active value on row ${i + 2}`);
                return { externalId, name, kind: kind as AccountKind, active: enabled.toLowerCase() === 'true' };
              });
              setRows(preview); setImportVersion(config.profile!.version);
            } catch (e) { setError(userErrorMessage(e, 'Could not read the chart')); }
          }} /></label>
        {rows.length > 0 && <>
          <div className="max-h-72 overflow-auto rounded-xl border border-white/10"><table className="finance-table">
            <thead><tr><th>External ID</th><th>Account name</th><th>Type</th><th>Action</th></tr></thead>
            <tbody>{rows.map((row, i) => <tr key={i}><td className="font-mono">{row.externalId}</td><td>{row.name}</td><td>{row.kind}</td>
              <td>{config.accounts.some(a => a.externalId === row.externalId) ? 'Update' : 'Create'}{!row.active ? ' · Inactive' : ''}</td></tr>)}</tbody>
          </table></div>
          <button className="workspace-button workspace-button-primary" disabled={busy} onClick={async () => {
            if (!sessionToken || busy) return; setBusy(true); setError('');
            try { const result = await importAccounts({ orgId, sessionToken, expectedVersion: importVersion, accounts: rows });
              setRows([]); setSuccess(`Chart saved. ${result.changed} account mappings changed.`); }
            catch (e) { setError(userErrorMessage(e, 'Could not import the chart')); } finally { setBusy(false); }
          }}>Import {rows.length} reviewed accounts</button>
        </>}
      </section>}
    </div>
  </Dialog>;
}
