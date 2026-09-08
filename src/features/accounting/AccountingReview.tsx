import { userErrorMessage } from '@/lib/userErrors';
import { useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { AccountingSource } from '../../../convex/lib/accountingSource';
import { accountingTreatments, buildSettlementJournal, bookUnits, type AccountingTreatment, type BookAccount, type JournalLine, type AccountKind } from '../../../shared/accounting';
import { formatUnits } from 'viem';
import { Dialog } from '@/components/ui/Dialog';
import { Notice, LoadingRows } from '@/components/workspace/WorkspacePrimitives';
import { useSessionToken } from '@/lib/session';
import { JournalPreview } from './JournalPreview';
import { getChainName } from '@/lib/chains';

type Details = FunctionReturnType<typeof api.accounting.sourceDetails>;
type Configuration = FunctionReturnType<typeof api.accounting.configuration>;
export function AccountingReview({ orgId, source, onClose }: { orgId: Id<'orgs'>; source: AccountingSource; onClose: () => void }) {
  const sessionToken = useSessionToken();
  const details = useQuery(api.accounting.sourceDetails, sessionToken ? { orgId, sessionToken, source } : 'skip');
  const config = useQuery(api.accounting.configuration, sessionToken ? { orgId, sessionToken } : 'skip');
  const [correcting, setCorrecting] = useState<string>();
  const verifyReceipt = useAction(api.receiptEvidence.verify);
  const [verifying, setVerifying] = useState(false), [verifyError, setVerifyError] = useState('');
  return <Dialog title="Reconcile with your books" onClose={onClose}>
    <div className="space-y-5 p-5 sm:p-6">
      {!details || !config ? <LoadingRows /> : details.error || !details.fact ? <>
        <Notice>{verifyError || details.error}</Notice>
        {source.kind === 'receipt' && <button className="workspace-button" disabled={verifying} onClick={async () => {
          if (!sessionToken || verifying) return; setVerifying(true); setVerifyError('');
          try { await verifyReceipt({ eventId: source.id as Id<'receivableEvents'>, sessionToken }); }
          catch (e) { setVerifyError(userErrorMessage(e, 'The original receipt could not be verified')); }
          finally { setVerifying(false); }
        }}>{verifying ? 'Verifying original receipt…' : 'Verify original receipt'}</button>}
      </>
        : !config.profile ? <Notice tone="info">Set up your book and chart of accounts in Reports → Reconciliation first.</Notice> : <>
          <section className="rounded-xl border border-white/10 p-4 space-y-2" aria-label={details.fact.nonCash ? "Issued credit note" : "Settled movement"}>
            <p className="font-semibold">{details.fact.label}</p>
            <p className="text-lg font-semibold tabular-nums">{details.fact.amount} {details.fact.token}
              <span className="ml-2 text-xs font-normal text-slate-400">{details.fact.nonCash ? 'Credit issued · no funds moved' : details.fact.direction === 'inflow' ? 'Received' : 'Sent'}</span></p>
            <p className="text-sm">{details.fact.accountName} · {getChainName(details.fact.chainId)}</p>
            <p className="text-xs text-slate-400">{details.fact.nonCash ? 'Issued' : 'Settled'} {new Date(details.fact.settledAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</p>
            {details.fact.companyTransfer && <p className="text-sm">Company transfer · {details.fact.companyAccountName}</p>}
            {details.fact.references.map(ref => <p key={ref.id} className="text-sm">Source {ref.kind}: {ref.number}</p>)}
            {details.fact.invoiceExcessRaw && BigInt(details.fact.invoiceExcessRaw) > 0n && <Notice tone="info">
              {formatUnits(BigInt(details.fact.invoiceAppliedRaw ?? '0'), details.fact.decimals)} {details.fact.token} applies to this invoice.
              {' '}{formatUnits(BigInt(details.fact.invoiceExcessRaw), details.fact.decimals)} {details.fact.token} is an excess receipt. Keep its reviewed book value in a customer liability account.
            </Notice>}
            {!details.fact.nonCash && <details className="text-xs text-slate-400"><summary className="cursor-pointer">Settlement evidence</summary>
              <p className="mt-2 break-all">Account: {details.fact.accountAddress}</p>
              <p className="mt-2 break-all">Counterparty: {details.fact.counterpartyAddress}</p>
              <p className="mt-2 break-all">Transaction: {details.fact.txHash}</p>
              <p className="mt-2 break-all">Transfer: {details.fact.transferId}</p>
              <p className="mt-2">Date evidence: {details.fact.dateSource === 'settlement' ? 'Verified block' : 'Account history provider'} · Block {details.fact.blockNumber}</p>
            </details>}
          </section>
          {details.entry && correcting !== details.entry._id ? <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{details.entry.journalNumber}</h3>
              <span className="workspace-status">{details.entry.state === 'ready' ? 'Ready to export' : details.entry.state === 'exported' ? 'Awaiting import confirmation' : 'Reconciled'}</span></div>
            <p className="text-sm">{accountingTreatments[details.entry.treatment]}</p>
            <p className="text-sm">Book reference: {details.entry.bookReference} · Accounting date: {details.entry.postingDate}</p>
            {details.entry.lines.length ? <JournalPreview lines={details.entry.lines} currency={details.entry.currency} />
              : <Notice tone="info">Matched to an existing book transaction. No journal is queued for import.</Notice>}
            <p className="text-sm text-slate-400">{details.entry.valuationEvidence}</p>
            {config.canReview && details.entry.state !== 'exported' && details.entry.treatment !== 'already_recorded' && <button className="workspace-button"
              onClick={() => setCorrecting(details.entry!._id)}>Correct this journal</button>}
            {details.entry.state === 'exported' && <p className="text-sm text-slate-400">Confirm the import in Reports → Reconciliation → Exports before correcting this journal.</p>}
          </section> : config.canReview ? <ReviewForm key={`${details.fact.fingerprint}:${config.profile.version}:${details.entry?._id ?? 'new'}`}
            orgId={orgId} details={details} config={config} onSaved={() => setCorrecting(undefined)} />
            : <Notice tone="info">An accountant, approver or workspace admin can reconcile this movement.</Notice>}
          {!!details.history.length && <details className="space-y-3 text-sm">
            <summary className="cursor-pointer font-medium">Review and correction history</summary>
            <ul className="space-y-3">{details.history.map(entry => <li key={entry._id} className="rounded-lg border border-white/10 p-3">
              <p>{entry.journalNumber} · {entry.postingDate} · {entry.state}</p>
              <p className="mt-1 text-slate-400">{entry.memo}</p>
              {entry.correctionReason && <p className="mt-1 text-slate-400">{entry.correctionReason}</p>}
            </li>)}</ul>
            {details.historyLimited && <p>Showing the latest 100 reviews.</p>}
          </details>}
        </>}
    </div>
  </Dialog>;
}

function ReviewForm({ orgId, details, config, onSaved }: { orgId: Id<'orgs'>; details: Details; config: Configuration; onSaved: () => void }) {
  const fact = details.fact!, profile = config.profile!, previous = details.entry;
  const sessionToken = useSessionToken(), save = useMutation(api.accounting.review);
  const [treatment, setTreatment] = useState<AccountingTreatment | ''>(previous?.treatment ?? '');
  const [assetId, setAssetId] = useState(previous?.lines[0]?.account.id ?? details.assetAccountId ?? '');
  const [counterId, setCounterId] = useState(previous?.treatment === 'credit_note' ? previous.lines.find(l=>l.account.kind === 'receivable')?.account.id ?? '' : previous?.lines[1]?.account.id ?? '');
  const [differenceId, setDifferenceId] = useState(previous?.lines.slice(2).find(line => ['income', 'expense'].includes(line.account.kind))?.account.id ?? '');
  const [advanceId, setAdvanceId] = useState((previous?.treatment === 'credit_note' ? previous.lines : previous?.lines.slice(2))?.find(line => line.account.kind === 'liability')?.account.id ?? '');
  const [advanceValue, setAdvanceValue] = useState(previous?.advanceBookValue ?? '');
  const [deliveryFeeValue, setDeliveryFeeValue] = useState(previous?.deliveryFeeBookValue ?? '');
  const [deliveryFeeId, setDeliveryFeeId] = useState(previous?.deliveryFeeBookValue !== undefined ? previous.lines.slice(2).find(line => line.account.kind === 'expense')?.account.id ?? '' : '');
  const [assetValue, setAssetValue] = useState(previous?.assetBookValue ?? '');
  const [obligationValue, setObligationValue] = useState(previous?.obligationBookValue ?? '');
  const [postingDate, setPostingDate] = useState(previous ? new Date().toISOString().slice(0, 10) : new Date(fact.settledAt).toISOString().slice(0, 10));
  const [reference, setReference] = useState(previous?.bookReference ?? '');
  const [externalName, setExternalName] = useState(previous?.externalName ?? '');
  const [evidence, setEvidence] = useState(previous?.valuationEvidence ?? '');
  const [memo, setMemo] = useState(previous?.memo ?? fact.label);
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const accounts = config.accounts.filter(a => a.active);
  const account = (id: string): BookAccount => {
    const row = accounts.find(a => a._id === id);
    if (!row) throw new Error('Choose the accounts in your books');
    return { id: row._id, externalId: row.externalId, name: row.name, kind: row.kind, version: row.version };
  };
  const obligation = treatment === 'existing_payable' || treatment === 'existing_receivable' || treatment === 'customer_refund';
  const credit = treatment === 'credit_note';
  const conversionReceipt = treatment === 'currency_conversion' && fact.direction === 'inflow';
  const withdrawal = treatment === 'investment_withdrawal';
  const receiptHasExcess = !!fact.invoiceExcessRaw && BigInt(fact.invoiceExcessRaw) > 0n;
  const needsAdvance = treatment === 'existing_receivable' && receiptHasExcess;
  const deliveryFeeRequired = !!fact.deliveryFeeRaw && BigInt(fact.deliveryFeeRaw) > 0n;
  const needsDeliveryFee = treatment === 'internal_transfer' && deliveryFeeRequired;
  let lines: JournalLine[] = [], previewError = '';
  try {
    if (!treatment) throw new Error('Choose how this movement should be reconciled');
    if (treatment === 'already_recorded') bookUnits(assetValue, profile.currency, true);
    else lines = buildSettlementJournal({ treatment, direction: fact.direction, currency: profile.currency,
      assetBookValue: assetValue, obligationBookValue: obligationValue, assetAccount: account(assetId), counterAccount: account(counterId),
      differenceAccount: differenceId ? account(differenceId) : undefined, externalName, companyTransfer: fact.companyTransfer, nonCash:fact.nonCash, customerRefund:fact.customerRefund, lendingMovement: fact.lendingMovement, conversionMovement: fact.conversionMovement,
      receiptHasExcess, advanceBookValue: advanceValue, advanceAccount: advanceId ? account(advanceId) : undefined,
      deliveryFeeRequired, deliveryFeeBookValue: deliveryFeeValue, deliveryFeeAccount: deliveryFeeId ? account(deliveryFeeId) : undefined });
  } catch (e) { previewError = userErrorMessage(e, 'Review the journal values'); }
  const options = (Object.keys(accountingTreatments) as AccountingTreatment[]).filter(value => value === 'already_recorded'
    || (fact.nonCash ? value === 'credit_note' : fact.customerRefund ? value === 'customer_refund' : fact.conversionMovement ? value === 'currency_conversion' : fact.lendingMovement ? value === (fact.lendingMovement === 'supply' ? 'investment_deposit' : 'investment_withdrawal') : fact.companyTransfer ? value === 'internal_transfer'
      : fact.direction === 'inflow' ? (value === 'customer_advance' || value === 'existing_receivable' && fact.invoiceAppliedRaw !== '0') : ['existing_payable', 'expense', 'fee'].includes(value)));
  const counterKind: AccountKind[] = ['internal_transfer', 'investment_deposit', 'investment_withdrawal', 'currency_conversion'].includes(treatment) ? ['asset'] : treatment === 'existing_payable' ? ['payable']
    : treatment === 'existing_receivable' || credit ? ['receivable'] : ['customer_advance','customer_refund'].includes(treatment) ? ['liability'] : ['expense'];
  const selectAccount = (label: string, value: string, onChange: (value: string) => void, kinds: AccountKind[]) => <label className="block">
    <span className="finance-label">{label}</span><select className="finance-field" aria-label={label} value={value} onChange={e => { onChange(e.target.value); setReviewed(false); }}>
      <option value="">Choose an account</option>{accounts.filter(a => kinds.includes(a.kind)).map(a => <option key={a._id} value={a._id}>{a.name} · {a.externalId}</option>)}
    </select></label>;
  return <form className="space-y-5" onSubmit={async e => {
    e.preventDefault(); if (busy || !sessionToken || !treatment || !reviewed || previewError) return;
    setBusy(true); setError('');
    try {
      await save({ orgId, sessionToken, source: fact.source, expectedFingerprint: fact.fingerprint, expectedProfileVersion: profile.version,
        treatment, postingDate, assetBookValue: assetValue, obligationBookValue: obligation || credit || withdrawal || conversionReceipt ? obligationValue : undefined,
        assetAccountId: assetId ? assetId as Id<'accountingAccounts'> : undefined, counterAccountId: counterId ? counterId as Id<'accountingAccounts'> : undefined,
        differenceAccountId: differenceId ? differenceId as Id<'accountingAccounts'> : undefined,
        advanceAccountId: (needsAdvance || credit) && advanceId ? advanceId as Id<'accountingAccounts'> : undefined,
        advanceBookValue: needsAdvance ? advanceValue : undefined,
        deliveryFeeBookValue: needsDeliveryFee ? deliveryFeeValue : undefined,
        deliveryFeeAccountId: needsDeliveryFee && deliveryFeeId ? deliveryFeeId as Id<'accountingAccounts'> : undefined,
        bookReference: reference, externalName: externalName || undefined, valuationEvidence: evidence, memo,
        replaces: previous?._id, correctionReason: previous ? reason : undefined });
      onSaved();
    } catch (e) { setError(userErrorMessage(e, 'Could not save reconciliation')); }
    finally { setBusy(false); }
  }}>
    <p className="text-sm text-slate-400">Book values are in {profile.currency}. Use the carrying value and obligation balance from {profile.bookName}. {fact.nonCash ? 'The issued credit is' : 'The settled quantity remains'} {fact.amount} {fact.token}.</p>
    {fact.nonCash && <Notice tone="info">This credit adjusts the invoice without moving funds. Review how much reduces the customer's receivable and how much creates a liability available for refund. Match an existing credit instead if it is already in your books.</Notice>}
    {fact.customerRefund && <Notice tone="info">Release the recorded customer liability when booking this refund. Its execution fee has a separate review.</Notice>}
    {previous && <Notice tone="info">{previous.state === 'reconciled' ? 'This correction creates a reversal and a replacement for export together. The original journal is retained.' : 'The unexported review will be retained as voided and replaced with this journal.'}</Notice>}
    {error && <Notice>{error}</Notice>}
    {fact.treasuryTransferId && <Notice tone="info">Reconcile both sides through the same transfer clearing account. The sending account records the full debit; the receiving account records its net receipt and the provider's retained delivery fee. Keep the separate execution fee in its own review.</Notice>}
    {fact.conversionMovement && <Notice tone="info">Reconcile the paid and received currencies through the same conversion clearing account. Use the actual paid currency carrying value for the outgoing entry and the amount released from clearing for the incoming entry. Review any valuation difference separately. The execution fee has its own entry.</Notice>}
    {fact.lendingMovement && <Notice tone="info">Use a separate asset account for the Aave lending position. For withdrawals, use the carrying value of the units redeemed, including income already accrued in your books. Only a remaining difference creates an income or loss entry. Execution fees have their own review.</Notice>}
    <label className="block"><span className="finance-label">How is this recorded in your books?</span>
      <select className="finance-field" value={treatment} onChange={e => { setTreatment(e.target.value as AccountingTreatment); setCounterId(''); setDifferenceId(''); setReviewed(false); }} required>
        <option value="">Choose accounting treatment</option>{options.map(value => <option key={value} value={value}>{accountingTreatments[value]}</option>)}
      </select></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label><span className="finance-label">Accounting date</span><input className="finance-field" type="date" value={postingDate} onChange={e => { setPostingDate(e.target.value); setReviewed(false); }} required /></label>
      <label><span className="finance-label">Book / obligation reference</span><input className="finance-field" value={reference} onChange={e => { setReference(e.target.value); setReviewed(false); }} maxLength={200} required placeholder="ID or reference in your accounting system" /></label>
    </div>
    {profile.closedThrough && <p className="text-xs text-slate-400">Books closed through {profile.closedThrough}.</p>}
    {treatment && treatment !== 'already_recorded' && <div className="grid gap-4 sm:grid-cols-2">
      {selectAccount(credit ? 'Sales returns or adjustment account' : 'Holding account in your books', assetId, setAssetId, credit ? ['income','expense'] : ['asset'])}
      {selectAccount('Offset account in your books', counterId, setCounterId, counterKind)}
    </div>}
    <div className="grid gap-4 sm:grid-cols-2">
      <label><span className="finance-label">{credit ? 'Credit book value' : 'Asset book value'} · {profile.currency}</span><input className="finance-field" inputMode="decimal" value={assetValue} onChange={e => { setAssetValue(e.target.value); setReviewed(false); }} placeholder="Enter the reviewed book value" required /></label>
      {credit && <label><span className="finance-label">Receivable reduction · {profile.currency}</span><input className="finance-field" inputMode="decimal" value={obligationValue} onChange={e=>{setObligationValue(e.target.value);setReviewed(false);}} required placeholder="Use zero if the invoice is already paid" /></label>}
      {obligation && <label><span className="finance-label">Obligation settled · {profile.currency}</span><input className="finance-field" inputMode="decimal" value={obligationValue} onChange={e => { setObligationValue(e.target.value); setReviewed(false); }} placeholder="Value of this settlement in the books" required /></label>}
      {withdrawal && <label><span className="finance-label">Lending asset carrying value released · {profile.currency}</span><input className="finance-field" inputMode="decimal" value={obligationValue} onChange={e => { setObligationValue(e.target.value); setReviewed(false); }} placeholder="Reviewed basis, including recorded accruals" required /></label>}
      {conversionReceipt && <label><span className="finance-label">Conversion clearing value released · {profile.currency}</span><input className="finance-field" inputMode="decimal" value={obligationValue} onChange={e => { setObligationValue(e.target.value); setReviewed(false); }} placeholder="Carrying value from the corresponding paid entry" required /></label>}
    </div>
    {needsDeliveryFee && <div className="grid gap-4 sm:grid-cols-2">
      <label><span className="finance-label">Delivery fee book value · {profile.currency}</span><input className="finance-field" inputMode="decimal" value={deliveryFeeValue} onChange={e => { setDeliveryFeeValue(e.target.value); setReviewed(false); }} required placeholder="Reviewed value of the retained fee" /></label>
      {selectAccount('Delivery fee expense account', deliveryFeeId, setDeliveryFeeId, ['expense'])}
    </div>}
    {(obligation || credit) && <>
      <label className="block"><span className="finance-label">Vendor or customer name in the books</span><input className="finance-field" value={externalName} onChange={e => { setExternalName(e.target.value); setReviewed(false); }} maxLength={200} required /></label>
      {needsAdvance && <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="finance-label">Excess receipt book value · {profile.currency}</span><input className="finance-field" inputMode="decimal" value={advanceValue}
          onChange={e => { setAdvanceValue(e.target.value); setReviewed(false); }} required placeholder="Reviewed value of the customer credit" /></label>
        {selectAccount('Customer liability for excess receipt', advanceId, setAdvanceId, ['liability'])}
      </div>}
      {!credit && selectAccount('Valuation difference account, if needed', differenceId, setDifferenceId, ['income', 'expense'])}
      {credit && selectAccount('Customer liability for refundable credit, if needed', advanceId, setAdvanceId, ['liability'])}
    </>}
    {(withdrawal || conversionReceipt) && selectAccount('Unrecorded income or valuation difference account, if needed', differenceId, setDifferenceId, ['income', 'expense'])}
    <label className="block"><span className="finance-label">Book value evidence</span><textarea className="finance-field min-h-20" value={evidence}
      onChange={e => { setEvidence(e.target.value); setReviewed(false); }} minLength={10} maxLength={1000} required placeholder="Carrying-value schedule, settlement valuation and policy reference" /></label>
    <label className="block"><span className="finance-label">Journal description</span><input className="finance-field" value={memo} onChange={e => { setMemo(e.target.value); setReviewed(false); }} maxLength={500} required /></label>
    {previous && <label className="block"><span className="finance-label">Correction reason</span><textarea className="finance-field" value={reason} onChange={e => setReason(e.target.value)} minLength={10} maxLength={500} required /></label>}
    {lines.length ? <JournalPreview lines={lines} currency={profile.currency} /> : <p className="text-sm text-slate-400">{previewError || 'This records a match to your existing books without creating another journal.'}</p>}
    {previewError && lines.length === 0 && treatment && <span className="sr-only" role="status">{previewError}</span>}
    <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
      <span>I reviewed the book values, account mappings and whether the obligation was already recorded.</span></label>
    <button className="workspace-button workspace-button-primary" disabled={busy || !reviewed || !!previewError}>
      {busy ? 'Saving review…' : previous ? 'Save linked correction' : treatment === 'already_recorded' ? 'Save book match' : 'Prepare journal'}
    </button>
  </form>;
}
