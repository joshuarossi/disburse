import { describe, expect, it } from 'vitest';
import { collectReportExport } from '../../pages/reports/reportExport';

function page(items: string[], isDone: boolean, continueCursor: string, indexVersion = 1) {
  return { items, isDone, continueCursor, indexVersion, indexing: false, indexErrors: [], rangeError: '' };
}
const options = () => ({ signal: new AbortController().signal, progress: () => undefined });
describe('complete report exports', () => {
  it('continues through empty filtered pages and binds every later page to the original version', async () => {
    const seen: unknown[] = [];
    const rows = await collectReportExport(async (cursor, version) => {
      seen.push([cursor, version]);
      return !cursor ? page([], false, 'next') : page(['0.000001', '9007199254740993.000001'], true, '');
    }, options());
    expect(rows).toEqual(['0.000001', '9007199254740993.000001']);
    expect(seen).toEqual([[undefined, undefined], ['next', 1]]);
  });
  it('refuses partial or changed histories and repeated cursors', async () => {
    await expect(collectReportExport(async () => ({ ...page([], true, ''), indexing: true }), options())).rejects.toThrow('finish refreshing');
    await expect(collectReportExport(async cursor => page(['1'], !!cursor, 'next', cursor ? 2 : 1), options())).rejects.toThrow('changed');
    await expect(collectReportExport(async () => page([], false, 'next'), options())).rejects.toThrow('next report page');
  });
  it('stops cancelled and oversized exports without returning a partial file', async () => {
    const controller = new AbortController();
    await expect(collectReportExport(async () => { controller.abort(); return page(['1'], true, ''); }, { signal: controller.signal, progress: () => undefined })).rejects.toThrow('cancelled');
    await expect(collectReportExport(async () => page(Array.from({ length: 10001 }, () => '1'), true, ''), options())).rejects.toThrow('too large');
  });
});
