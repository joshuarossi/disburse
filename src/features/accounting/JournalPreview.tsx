import type { JournalLine } from '../../../shared/accounting';
export function JournalPreview({ lines, currency }: { lines: JournalLine[]; currency: string }) {
  return <>
    <ul className="sm:hidden divide-y divide-white/10 rounded-xl border border-white/10" aria-label={`Journal preview in ${currency}`}>
      {lines.map((line, i) => <li key={i} className="space-y-2 p-4 text-sm">
        <p className="font-medium break-words">{line.account.name}</p><p className="text-xs text-slate-400">{line.account.externalId}{line.name ? ` · ${line.name}` : ''}</p>
        <dl className="grid grid-cols-2 gap-4 tabular-nums"><div><dt className="text-xs text-slate-400">Debit · {currency}</dt><dd>{line.debit || '—'}</dd></div>
          <div><dt className="text-xs text-slate-400">Credit · {currency}</dt><dd>{line.credit || '—'}</dd></div></dl>
      </li>)}
    </ul>
    <div className="hidden sm:block workspace-table-wrap rounded-xl border border-white/10">
    <table className="workspace-table" aria-label={`Journal preview in ${currency}`}>
      <thead><tr><th>Account in your books</th><th className="numeric">Debit · {currency}</th><th className="numeric">Credit · {currency}</th></tr></thead>
      <tbody>{lines.map((line, i) => <tr key={i}>
        <td><span className="block font-medium">{line.account.name}</span>
          <span className="workspace-table-secondary">{line.account.externalId}{line.name ? ` · ${line.name}` : ''}</span></td>
        <td className="numeric">{line.debit || '—'}</td><td className="numeric">{line.credit || '—'}</td>
      </tr>)}</tbody>
    </table>
  </div></>;
}
