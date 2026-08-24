// Extracted from src/pages/Disbursements.tsx (M-04 decomposition).
export function getStatusColor(status: string) {
  switch (status) {
    case 'executed':
      return 'bg-green-500/10 text-green-400';
    case 'failed':
    case 'cancelled':
      return 'bg-red-500/10 text-red-400';
    case 'pending':
    case 'proposed':
    case 'scheduled':
    case 'relaying':
      return 'bg-yellow-500/10 text-yellow-400';
    default:
      return 'bg-slate-500/10 text-slate-400';
  }
}
