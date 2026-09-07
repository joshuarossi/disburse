import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { getSessionToken } from '@/lib/session';

export function ReportProgress({ orgId, data, page, previous, next }: {
  orgId?: string;
  data?: { indexing?: boolean; indexErrors?: string[]; rangeError?: string; isDone?: boolean; continueCursor?: string; items: unknown[] };
  page: number; previous: () => void; next: (cursor: string) => void;
}) {
  const refresh = useMutation(api.reportIndex.refresh);
  const initialized = useRef('');
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  async function retry() {
    if (!orgId || !getSessionToken() || retrying) return;
    setRetrying(true); setError('');
    try { await refresh({ orgId: orgId as Id<'orgs'>, sessionToken: getSessionToken()! }); }
    catch { setError('Transaction history could not be refreshed. Try again.'); }
    finally { setRetrying(false); }
  }
  useEffect(() => {
    if (!orgId || !getSessionToken() || initialized.current === orgId) return;
    initialized.current = orgId; void retry();
    // Start/resume durable background work once when entering this workspace report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  return <>
    {(data?.indexing || error || !!data?.indexErrors?.length) && <div className="workspace-notice" role="status" data-tone={error || data?.indexErrors?.length ? 'error' : undefined}>
      <div><strong>{error || (data?.indexErrors?.length ? 'Some transaction history needs attention' : 'Preparing transaction history')}</strong>
        <p>{data?.indexErrors?.[0] ?? 'Recorded entries remain available. Complete totals and exports will be available when this finishes.'}</p>
        <button type="button" className="workspace-button mt-2" onClick={() => void retry()} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry history update'}</button>
      </div>
    </div>}
    {data?.rangeError && <div className="workspace-notice" data-tone="error" role="alert">{data.rangeError}</div>}
    {data && (page > 1 || data.isDone === false) && <nav className="flex flex-wrap items-center gap-3" aria-label="Report pages">
      <button type="button" className="workspace-button" disabled={page === 1} onClick={previous}>Previous page</button>
      <span className="text-sm text-slate-400">Page {page}{!data.items.length ? ' · no matches on this page' : ''}</span>
      <button type="button" className="workspace-button" disabled={data.isDone !== false || !data.continueCursor} onClick={() => next(data.continueCursor!)}>Next page</button>
    </nav>}
  </>;
}
