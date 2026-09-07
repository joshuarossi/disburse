export type Cadence = 'weekly' | 'biweekly' | 'monthly';
export const PREPARATION_LEAD_MS = 3 * 24 * 60 * 60 * 1000;

// Anchor monthly runs to the original day, including after a short month.
export function nextPayDate(
  current: number,
  cadence: Cadence,
  anchorDay: number,
): number {
  const date = new Date(current);
  if (cadence === 'monthly') {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(month);
    date.setUTCDate(Math.min(anchorDay, lastDay));
  } else {
    date.setUTCDate(date.getUTCDate() + (cadence === 'weekly' ? 7 : 14));
  }
  return date.getTime();
}
