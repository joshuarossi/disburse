const DAY = 86_400_000;
export function reportPeriods(timestamp: number) {
  const day = new Date(timestamp).toISOString().slice(0, 10);
  return ['all', day.slice(0, 7), day];
}

/** Disjoint UTC buckets: whole months plus days at either edge. */
export function reportRangePeriods(start?: number, end?: number, first?: number) {
  if (start === undefined && end === undefined) return ['all'];
  const from = Math.floor((start ?? Math.min(first ?? Date.now(), end ?? Date.now())) / DAY) * DAY;
  const through = Math.floor((end ?? Date.now()) / DAY) * DAY + DAY;
  if (!Number.isFinite(from) || !Number.isFinite(through) || through <= from)
    throw new Error('Choose an end date on or after the start date');
  if (through - from > 732 * DAY)
    throw new Error('Choose a date range of up to two years, or clear both dates for all history');
  const periods: string[] = [];
  for (let at = from; at < through;) {
    const date = new Date(at);
    const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    if (date.getUTCDate() === 1 && nextMonth <= through) {
      periods.push(date.toISOString().slice(0, 7));
      at = nextMonth;
    } else {
      periods.push(date.toISOString().slice(0, 10));
      at += DAY;
    }
  }
  return periods;
}
