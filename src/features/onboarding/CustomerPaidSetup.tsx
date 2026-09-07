import { useEffect, useRef, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useAccount, useSwitchChain } from 'wagmi';
import { encodeFunctionData, erc20Abi, getAddress, formatUnits, keccak256, parseUnits, toHex, type Address } from 'viem';
import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import { useSessionToken } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/workspace/WorkspacePrimitives';
import { walletDeclined, walletErrorMessage } from '@/lib/walletErrors';
import { CHAIN_TOKENS, type SupportedChainId } from '@/lib/chains';
import { CUSTOMER_EXECUTION_CHAINS } from '../../../shared/customerPaidExecution';
import { readServiceRecord, restoreCustomerIntent, type CustomerServiceRecord } from '../../../shared/customerServiceRecord';
import type { CustomerServiceQuote } from '@/lib/services/customerExecution';

type PreparedSetup = CustomerServiceQuote & { account: { address: Address; owners: Address[]; threshold: number } };
const amountLabel = (amount: bigint | string) => `${formatUnits(BigInt(amount), 6)} USDC`;

export function CustomerPaidSetup({ orgId, owners, threshold, chainId, onBusy, onComplete, onRestore }: {
  orgId: Id<'orgs'>; owners: string[]; threshold: number; chainId: number; onBusy: (busy: boolean) => void; onComplete: () => void; onRestore: (settings: { chainId: number; owners: string[]; threshold: number }) => void;
}) {
  const sessionToken = useSessionToken();
  const { address, chain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const begin = useMutation(api.customerOperations.begin);
  const refresh = useAction(api.customerExecution.refresh);
  const link = useAction(api.customerExecution.completeSetup);
  const current = useQuery(api.customerOperations.current, sessionToken ? { orgId, sessionToken } : 'skip');
  const conflict = useQuery(api.customerOperations.conflict, sessionToken ? { orgId, chainId, sessionToken } : 'skip');
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<PreparedSetup | null>(null);
  const [pending, setPending] = useState<Doc<'customerOperations'> | null>(null);
  const [stage, setStage] = useState<'idle' | 'quoting' | 'review' | 'signing' | 'submitting' | 'checking' | 'complete'>('idle');
  const [notice, setNotice] = useState<{ message: string; tone: 'info' | 'error' } | null>(null);
  const [now, setNow] = useState(Date.now());
  const lock = useRef(false);
  const restored = useRef<string | null>(null);
  const working = ['quoting', 'signing', 'submitting', 'checking'].includes(stage);
  const operation = pending ?? current;
  const supported = CUSTOMER_EXECUTION_CHAINS.includes(chainId as typeof CUSTOMER_EXECUTION_CHAINS[number]);
  useEffect(() => {
    if (!operation || restored.current === operation._id) return;
    restored.current = operation._id;
    try {
      const saved = readServiceRecord(operation.record);
      if (saved.account) onRestore({ chainId: saved.intent.chainId, owners: saved.account.owners, threshold: saved.account.threshold });
    } catch {
      setNotice({ tone: 'error', message: 'The saved setup details could not be read. Keep this request for recovery before starting another setup.' });
    }
  }, [operation, onRestore]);
  const expired = !!prepared && prepared.expiresAt <= now + 30_000;
  useEffect(() => { onBusy(working || !!prepared || !!operation || !!conflict); }, [working, prepared, operation, conflict, onBusy]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (prepared && (prepared.intent.chainId !== chainId || prepared.account.threshold !== threshold || prepared.account.owners.map(o => o.toLowerCase()).join(':') !== owners.map(o => o.toLowerCase()).join(':'))) {
      setPrepared(null); setStage('idle'); setNotice({ tone: 'info', message: 'Account settings changed. Review a fresh fee quote before continuing.' });
    }
  }, [prepared, chainId, threshold, owners]);

  async function quote() {
    if (lock.current || !address || !sessionToken || operation || conflict || current === undefined || conflict === undefined) return;
    lock.current = true; setStage('quoting'); setNotice(null); setPrepared(null);
    try {
      if (!/^\d+(?:\.\d{1,6})?$/.test(amount.trim())) throw new Error('Enter a deposit amount with no more than six decimal places.');
      const deposit = parseUnits(amount.trim(), 6);
      if (chain?.id !== chainId) await switchChainAsync({ chainId });
      const [{ createSafe }, execution] = await Promise.all([import('@/lib/safeCreation'), import('@/lib/services/customerExecution')]);
      execution.serviceChain(chainId);
      const { predictedAddress, deployTx } = await createSafe(owners, threshold, BigInt(keccak256(toHex(orgId))).toString(), chainId);
      if (await execution.serviceReader(chainId).getCode({ address: getAddress(predictedAddress) })) throw new Error('This account is already deployed. Link the existing account to continue.');
      const token = CHAIN_TOKENS[chainId as SupportedChainId].USDC.address;
      const result = await execution.quoteCustomerExecution({ chainId, owner: address, amount: deposit, calls: [
        { to: getAddress(deployTx.to), data: deployTx.data as `0x${string}`, value: deployTx.value },
        { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [getAddress(predictedAddress), deposit] }), value: 0n },
      ] });
      setPrepared({ ...result, account: { address: getAddress(predictedAddress), owners: owners.map(getAddress), threshold } });
      setStage('review');
    } catch (error) {
      setStage('idle'); setNotice({ tone: walletDeclined(error) ? 'info' : 'error', message: walletErrorMessage(error, 'Could not prepare account setup. Your details are saved. Check your wallet connection and try again.') });
    } finally { lock.current = false; }
  }

  async function confirm() {
    if (lock.current || !prepared || !sessionToken || operation || expired) return;
    lock.current = true; setNotice(null); setStage('signing');
    let signed = false, recorded = false;
    try {
      const execution = await import('@/lib/services/customerExecution');
      const payload = await execution.signCustomerExecution(prepared);
      signed = true;
      // The service never receives a signature until recovery data is durable.
      const record: CustomerServiceRecord = { intent: { ...prepared.intent, amount: prepared.intent.amount.toString(), calls: prepared.intent.calls.map(call => ({ ...call, value: call.value.toString() })) }, quote: prepared.quote, startBlock: prepared.startBlock.toString(), account: prepared.account };
      setStage('submitting');
      const operationId = await begin({ orgId, sessionToken, record: JSON.stringify(record) });
      recorded = true;
      const recovery = { _id: operationId, record: JSON.stringify(record), hash: prepared.quote.hash, chainId, fee: prepared.fee.toString(), feePaid: false, state: 'pending' } as Doc<'customerOperations'>;
      setPending(recovery);
      // One POST only. A timeout or malformed response must recover this hash.
      const result = await execution.serviceRequest('exec', payload) as { hash?: string };
      if (result?.hash?.toLowerCase() !== prepared.quote.hash.toLowerCase()) throw new Error('Unconfirmed submission response');
      setNotice({ tone: 'info', message: 'Account setup submitted. Check its status below; your account is ready after the network confirms it.' });
      setStage('idle');
    } catch (error) {
      setStage(prepared ? 'review' : 'idle');
      setNotice({ tone: !signed && walletDeclined(error) ? 'info' : 'error', message: recorded
        ? 'The service did not confirm the submission. Your original request is saved. Check its status before trying another setup.'
        : signed
          ? 'Your signed request could not be saved. It was not sent to the execution service. Check for a saved request below before trying again.'
          : walletDeclined(error)
            ? 'Account setup cancelled. Your settings and deposit amount are saved. Confirm when you are ready.'
            : walletErrorMessage(error, 'Could not authorize account setup. Your settings are saved. Reconnect your wallet and try again.') });
    } finally { lock.current = false; }
  }

  async function check() {
    if (lock.current || !operation || !sessionToken) return;
    lock.current = true; setStage('checking'); setNotice(null);
    try {
      const result = await refresh({ operationId: operation._id, sessionToken });
      if (result.state === 'confirmed') {
        const saved = readServiceRecord(operation.record);
        if (!saved.account) throw new Error('The saved account details could not be found.');
        await link({ operationId: operation._id, sessionToken });
        setStage('complete'); onComplete(); return;
      }
      if (result.state === 'pending') setNotice({ tone: 'info', message: 'Confirmation is still pending. Your original request is being checked. No new fee or payment was submitted.' });
      else {
        const saved = readServiceRecord(operation.record);
        setAmount(formatUnits(restoreCustomerIntent(saved).amount, 6)); setPrepared(null); setPending(null);
        setNotice({ tone: 'error', message: `${result.state === 'failed' ? 'Account setup failed.' : 'The request expired without completing account setup.'} Your deposit was not transferred. ${result.feePaid ? `The provider charged ${amountLabel(operation.fee)} for the attempt.` : 'No provider fee was confirmed.'} Review a new quote to try again.` });
      }
      setStage('idle');
    } catch (error) {
      setStage('idle'); setNotice({ tone: 'error', message: walletErrorMessage(error, 'Could not verify account setup yet. Your original request is saved. Check again shortly.') });
    } finally { lock.current = false; }
  }

  async function checkEarlier() {
    if (lock.current || !conflict || !sessionToken) return;
    lock.current = true; setStage('checking'); setNotice(null);
    try {
      const result = await refresh({ operationId: conflict.operationId, sessionToken });
      setNotice({ tone: 'info', message: result.state === 'pending' ? 'The earlier setup is still pending. Checking its status does not submit another request or charge a fee.' : 'The earlier request is resolved. You can review setup for this organization.' });
    } catch (error) { setNotice({ tone: 'error', message: walletErrorMessage(error, 'Could not check the earlier setup. Your request is saved. Try checking again shortly.') }); }
    finally { setStage('idle'); lock.current = false; }
  }

  return <section className="space-y-4" aria-label="Account setup cost">
    {(current === undefined || conflict === undefined) && <Notice tone="info">Checking for an earlier setup request…</Notice>}
    {!operation && !prepared && !conflict && <>
      <p className="workspace-description">Create your company account and fund it from your wallet. You pay the setup fee in USDC. No ETH is needed.</p>
      <label className="block"><span className="finance-label">Deposit into company account (USDC)</span><input className="finance-field" inputMode="decimal" placeholder="100.00" value={amount} disabled={working} onChange={e => setAmount(e.target.value)} /></label>
      <p className="text-sm text-slate-400">Enter 0 to create an empty account. Your wallet still needs USDC for the setup fee.</p>
      {!supported && <Notice tone="info">USDC setup fees are not available on this network. Choose Base, Arbitrum, Ethereum, Polygon or Base Sepolia.</Notice>}
    </>}
    {notice && <Notice tone={notice.tone}>{notice.message}</Notice>}
    {operation ? <>
      {!notice && <Notice tone="info">An account setup request is saved for this wallet. Check it before starting another.</Notice>}
      <p className="workspace-description">Approved provider fee: {amountLabel(operation.fee)}. Checking status does not charge a fee.</p>
      <Button onClick={check} disabled={working} className="w-full">{working ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {working ? 'Checking setup…' : 'Check setup status'}</Button>
    </> : conflict ? <>
      <Notice tone="info">This wallet has an unresolved account setup in another organization. Check that request before authorizing another setup on this network.</Notice>
      <Button onClick={checkEarlier} disabled={working} className="w-full">{working ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{working ? 'Checking earlier setup…' : 'Check earlier setup'}</Button>
    </> : prepared ? <>
      <div className="rounded-lg border border-slate-400/20 p-4 space-y-3" aria-label="Setup review">
        <div className="flex justify-between gap-4"><span>Company account deposit</span><strong>{amountLabel(prepared.intent.amount)}</strong></div>
        <div className="flex justify-between gap-4"><span>Biconomy setup fee</span><strong>{amountLabel(prepared.fee)}</strong></div>
        <div className="flex justify-between gap-4 border-t border-slate-400/20 pt-3"><span>Total from your wallet</span><strong>{amountLabel(prepared.debit)}</strong></div>
      </div>
      <p className="workspace-description">Your wallet will ask for a USDC authorization limited to the total above. The provider fee covers execution. If account creation fails, your deposit stays in your wallet, but the provider fee may still be charged. Any unused gas refund is returned by the provider in the network’s native currency.</p>
      {expired && <Notice tone="info">This fee quote expired. Request a fresh quote before confirming.</Notice>}
      <div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={working} onClick={() => { setPrepared(null); setStage('idle'); setNotice(null); }}>Edit setup</Button><Button className="min-w-0 flex-1" disabled={working || expired} onClick={confirm}>{working ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{stage === 'signing' ? 'Confirm in your wallet…' : stage === 'submitting' ? 'Submitting setup…' : 'Confirm account setup'}</Button></div>
      {expired && <Button variant="secondary" disabled={working} onClick={quote}>Refresh fee quote</Button>}
    </> : <Button onClick={quote} disabled={working || !supported || !amount.trim() || !sessionToken || current === undefined || conflict === undefined} className="w-full">{working && <Loader2 className="h-4 w-4 animate-spin" />}{working ? 'Getting setup cost…' : 'Review setup cost'}</Button>}
  </section>;
}
