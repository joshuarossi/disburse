import { useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import { formatUnits } from 'viem';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { CHAIN_TOKENS, CHAIN_NAMES, type SupportedChainId } from '../../../shared/chains';
import { chainEnvironment } from '../../../shared/assets';
import { useSessionToken } from '@/lib/session';
import { Notice, LoadingRows } from '@/components/workspace/WorkspacePrimitives';
import { exportToCsv } from '@/lib/csv';

export function AccountBalanceReview({ orgId, environment, canReview }: { orgId: Id<'orgs'>; environment: 'production' | 'test'; canReview: boolean }) {
  const sessionToken = useSessionToken(), check = useAction(api.accountBalances.check);
  const accounts = useQuery(api.safes.getForOrg, sessionToken ? { orgId, sessionToken } : 'skip');
  const checks = useQuery(api.accountBalances.list, sessionToken ? { orgId, sessionToken, environment } : 'skip');
  const [accountId, setAccountId] = useState(''), [token, setToken] = useState('USDC');
  const now = new Date(), previousEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const [startDate, setStartDate] = useState(new Date(Date.UTC(previousEnd.getUTCFullYear(), previousEnd.getUTCMonth(), 1)).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(previousEnd.toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const available = accounts?.filter(a => a.isActive !== false && chainEnvironment(a.chainId) === environment) ?? [];
  const selected = available.find(a => a._id === accountId);
  const tokens = selected ? Object.values(CHAIN_TOKENS[selected.chainId as SupportedChainId] ?? {}) : [];
  return <div className="space-y-5">
    <p className="text-sm leading-6 text-slate-400">Check that opening units plus receipts minus payments equal the closing account balance. Dates use UTC. Each result retains its network checkpoints and exact quantities; book values and journal imports are reviewed separately.</p>
    {canReview && <form className="workspace-panel p-5 space-y-4" onSubmit={async e => {
      e.preventDefault(); if (!sessionToken || !selected || busy) return; setBusy(true); setError('');
      try { await check({ orgId, sessionToken, safeId: selected._id, token, startDate, endDate }); }
      catch (e) { setError(e instanceof Error ? e.message : 'Account history could not be verified. Refresh it and try again.'); }
      finally { setBusy(false); }
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="finance-label">Account to reconcile</span><select className="finance-field" value={accountId} onChange={e => { setAccountId(e.target.value); setToken('USDC'); }} required disabled={busy}>
          <option value="">Choose an account</option>{available.map(a => <option key={a._id} value={a._id}>{a.name ?? 'Company account'} · {CHAIN_NAMES[a.chainId as SupportedChainId]}</option>)}</select></label>
        <label><span className="finance-label">Account currency</span><select className="finance-field" value={token} onChange={e => setToken(e.target.value)} disabled={!selected || busy}>
          {tokens.map(t => <option key={t.address}>{t.symbol}</option>)}</select></label>
        <label><span className="finance-label">Period starts · UTC</span><input className="finance-field" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} disabled={busy} required /></label>
        <label><span className="finance-label">Period ends · UTC</span><input className="finance-field" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={busy} required /></label>
      </div>
      <p className="text-xs text-slate-400">Choose completed dates, through yesterday at the latest. Refresh Transactions first if account history is incomplete. Historical checks can take a minute.</p>
      {error && <Notice>{error}</Notice>}
      <button className="workspace-button workspace-button-primary" disabled={!selected || busy}>{busy ? 'Checking balances…' : 'Check period balances'}</button>
    </form>}
    {!checks ? <LoadingRows /> : !checks.length ? <p className="text-sm text-slate-400">No saved balance checks yet.</p> : <>
      <h3 className="font-semibold">Recent balance checks</h3>
      <p className="text-xs text-slate-400">Showing the latest 20 checks as they were recorded. Run a new check after correcting or refreshing history.</p>
      {checks.map(result => {
        const amount = (raw: string) => `${formatUnits(BigInt(raw), result.decimals)} ${result.token}`;
        return <section key={result._id} className="workspace-panel p-5 space-y-4" aria-label={`Balance check for ${result.accountName}`}>
          <div className="flex flex-wrap justify-between gap-3"><div><h4 className="font-semibold">{result.accountName} · {CHAIN_NAMES[result.chainId as SupportedChainId]}</h4>
            <p className="text-sm text-slate-400">{result.startDate} to {result.endDate} · UTC</p></div>
            <span className="workspace-status">{result.status === 'matched' ? 'Balances match' : 'Needs review'}</span></div>
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">{[
            ['Opening balance', result.opening.balanceRaw], ['Received', result.inflowRaw], ['Sent', result.outflowRaw], ['Closing balance', result.closing.balanceRaw],
          ].map(([label, raw]) => <div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 font-medium tabular-nums break-words">{amount(raw)}</dd></div>)}</dl>
          <p className="text-sm">Difference: {amount(result.differenceRaw)} · {result.movementCount} movements checked</p>
          {result.status === 'needs_review' && <Notice>{result.unresolvedCount ? `${result.unresolvedCount} movements need complete settlement evidence. ` : ''}Refresh account history and investigate the difference before relying on this period.</Notice>}
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-400">Checked {new Date(result.checkedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</p>
            <button className="workspace-button" onClick={() => {
              const row = { check_id: result._id, account: result.accountName, account_address: result.accountAddress,
                network_id: result.chainId, environment: result.environment, token: result.token, token_contract: result.tokenAddress, decimals: result.decimals,
                start_date_utc: result.startDate, end_date_utc: result.endDate, opening_units: formatUnits(BigInt(result.opening.balanceRaw), result.decimals),
                received_units: formatUnits(BigInt(result.inflowRaw), result.decimals), sent_units: formatUnits(BigInt(result.outflowRaw), result.decimals),
                closing_units: formatUnits(BigInt(result.closing.balanceRaw), result.decimals), difference_units: formatUnits(BigInt(result.differenceRaw), result.decimals),
                opening_block: result.opening.blockNumber, opening_hash: result.opening.blockHash, closing_block: result.closing.blockNumber, closing_hash: result.closing.blockHash,
                movements: result.movementCount, unresolved: result.unresolvedCount, report_revision: result.reportRevision,
                history_through_utc: new Date(result.historyThrough).toISOString(), checked_utc: new Date(result.checkedAt).toISOString(), status: result.status };
              exportToCsv(`disburse_balance_check_${result._id}`, [row], Object.keys(row).map(key => ({ key, label: key, numeric: key.endsWith('_units') })));
            }}>Download balance evidence</button></div>
        </section>;
      })}
    </>}
  </div>;
}
