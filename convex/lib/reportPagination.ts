import { paginationOptsValidator } from 'convex/server';
import type { Infer } from 'convex/values';

// Convex 1.31.7's validator/runtime support read limits; its older PaginationOptions
// declaration omits them. Infer the full supported shape from the shipped validator.
export function reportPage(cursor: string | null | undefined, numItems: number): Infer<typeof paginationOptsValidator> {
  return { cursor: cursor ?? null, numItems: Number.isFinite(numItems) ? Math.min(100, Math.max(1, Math.floor(numItems))) : 100, maximumRowsRead: 500, maximumBytesRead: 1_000_000 };
}
