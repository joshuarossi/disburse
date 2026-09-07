export interface ExportPage<T> {
  items: T[]; isDone: boolean; continueCursor: string; indexVersion: number;
  indexing: boolean; rangeError: string; indexErrors: string[];
}

/** No file is emitted until every bounded page belongs to the same completed index. */
export async function collectReportExport<T>(
  fetchPage: (cursor?: string, snapshotVersion?: number) => Promise<ExportPage<T>>,
  options: { signal: AbortSignal; progress: (count: number) => void },
) {
  let cursor: string | undefined, version: number | undefined, bytes = 0;
  const rows: T[] = [];
  const cursors = new Set<string>();
  for (let pageNumber = 0; pageNumber < 500; pageNumber++) {
    if (options.signal.aborted) throw new Error('Export cancelled');
    const page = await fetchPage(cursor, version);
    if (options.signal.aborted) throw new Error('Export cancelled');
    if (page.indexing || page.indexErrors.length) throw new Error('Wait for transaction history to finish refreshing before exporting');
    if (page.rangeError) throw new Error(page.rangeError);
    version ??= page.indexVersion;
    if (page.indexVersion !== version) throw new Error('Report activity changed during export. Refresh and try again.');
    rows.push(...page.items);
    bytes += new TextEncoder().encode(JSON.stringify(page.items)).byteLength;
    if (rows.length > 10_000 || bytes > 20_000_000) throw new Error('This export is too large. Choose a smaller date range; no partial file was downloaded.');
    options.progress(rows.length);
    if (page.isDone) return rows;
    if (!page.continueCursor || cursors.has(page.continueCursor)) throw new Error('The next report page could not be loaded. No partial file was downloaded.');
    cursors.add(page.continueCursor); cursor = page.continueCursor;
  }
  throw new Error('Choose a smaller date range to export this history; no partial file was downloaded.');
}
