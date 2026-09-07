import { useState } from 'react';
import { Notice } from '@/components/workspace/WorkspacePrimitives';

/** Sharing creates a draft in the customer's email app. It never calls an
 * application-funded delivery API or marks a message as delivered. */
export function InvitationLink({ url, email }: { url: string; email: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const subject = 'Your invitation to Disburse';
  const body = `You have been invited to a workspace on Disburse.\n\nOpen this private link, sign in, and confirm the wallet you will use:\n${url}\n\nThe invitation expires in seven days. Please do not forward this link.`;
  return <div className="space-y-3 min-w-0">
    <label className="block"><span className="finance-label">Private invitation link</span><input className="finance-field" value={url} readOnly onFocus={event => event.currentTarget.select()} /></label>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="workspace-button" onClick={async () => {
        setError('');
        try { await navigator.clipboard.writeText(url); setCopied(true); }
        catch { setError('The link could not be copied automatically. Select the link above and copy it.'); }
      }}>{copied ? 'Link copied' : 'Copy invitation link'}</button>
      <a className="workspace-button" href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>Open email draft</a>
    </div>
    <p className="workspace-description">Share this private link with {email}. Disburse has not sent an email.</p>
    {error && <Notice>{error}</Notice>}
  </div>;
}
