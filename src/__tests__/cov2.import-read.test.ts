import { describe, it, expect, vi } from 'vitest';

/**
 * Coverage top-up — read-spreadsheet.ts @22: the `if (Array.isArray(o.richText))`
 * TRUE side of the (non-exported) cellToString.
 *
 * ExcelJS normalises a *written* richText cell back to a plain string on read, so a
 * real round-trip hits the string branch, not @22. Instead we mock loadXlsxWorkbook
 * to hand readXlsx a worksheet whose cell value is a genuine `{ richText: [...] }`
 * object, so cellToString joins the segment texts.
 */

const { loadXlsxWorkbook } = vi.hoisted(() => ({ loadXlsxWorkbook: vi.fn() }));
vi.mock('@/lib/services/import/load-xlsx', () => ({ loadXlsxWorkbook }));

import { readSpreadsheet } from '@/lib/services/import/oneCAccountCard/read-spreadsheet';

describe('readSpreadsheet richText cell (@22)', () => {
  it('joins a richText cell object into its concatenated text', async () => {
    // Middle segment has no `text` → exercises the `r.text ?? ''` fallback too.
    const richCell = { value: { richText: [{ text: 'a' }, {}, { text: 'b' }] } };
    const emptyCell = { value: null };
    const fakeWs = {
      rowCount: 1,
      columnCount: 1,
      getRow: () => ({ getCell: (c: number) => (c === 1 ? richCell : emptyCell) })
    };
    loadXlsxWorkbook.mockResolvedValue({ worksheets: [fakeWs] } as never);

    const grid = await readSpreadsheet(Buffer.from('x'), 'card.xlsx');
    expect(grid[0][0]).toBe('ab');
  });
});
