/** Bills have calendar due dates in UTC, not a payment execution deadline. */
export function isBillOverdue(dueDate: number, now = Date.now()): boolean {
  return Math.floor(dueDate / 86_400_000) < Math.floor(now / 86_400_000);
}
