import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import {
  parseRusDate,
  parseAmount,
  extractDocNumber,
  extractAccountCandidates,
  extractCounterparty,
  extractInn,
  extractVat,
} from '@/lib/services/import/oneCAccountCard/extractors';
import { classifyRow } from '@/lib/services/import/oneCAccountCard/classify';
import { parseAccountCard } from '@/lib/services/import/oneCAccountCard/parser';
import { readSpreadsheet } from '@/lib/services/import/oneCAccountCard/read-spreadsheet';
import { matchRow } from '@/lib/services/import/oneCAccountCard/matcher';
import { loadXlsxWorkbook } from '@/lib/services/import/load-xlsx';
import type { ParsedRow } from '@/lib/services/import/oneCAccountCard/types';

// load-xlsx and xlsx are mocked so their default behaviour is the REAL impl
// (real cellToString exercise) but we can force an empty-worksheet result
// once per test to reach the `if (!ws) return []` guards.
vi.mock('@/lib/services/import/load-xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/import/load-xlsx')>();
  return { loadXlsxWorkbook: vi.fn(actual.loadXlsxWorkbook) };
});
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return { ...actual, read: vi.fn(actual.read) };
});

// ── extractors: remaining pure branches ────────────────────────────────────
describe('extractors — uncovered branches', () => {
  it('parseRusDate: matched-but-invalid calendar date → NaN branch → null (L13)', () => {
    // matches ДД.ММ.ГГГГ regex, but 2026-13-31 is not a real date → Date.parse NaN.
    expect(parseRusDate('31.13.2026')).toBeNull();
  });

  it('parseAmount: null input → null (L18)', () => {
    expect(parseAmount(null)).toBeNull();
  });
  it('parseAmount: non-finite garbage → null (L22)', () => {
    expect(parseAmount('abc')).toBeNull();
  });

  it('extractDocNumber: null input → null (L27)', () => {
    expect(extractDocNumber(null)).toBeNull();
  });
  it('extractDocNumber: no doc-number pattern → null (L29)', () => {
    expect(extractDocNumber('Поступление на расчетный счет без номера')).toBeNull();
  });

  it('extractAccountCandidates: falsy text → [] (L42)', () => {
    expect(extractAccountCandidates('')).toEqual([]);
    expect(extractAccountCandidates(null)).toEqual([]);
  });

  it('extractCounterparty: name collapses to empty after ИНН strip → null (L61)', () => {
    expect(extractCounterparty('ИНН 7712345678')).toBeNull();
  });

  it('extractInn: null input → null (L66)', () => {
    expect(extractInn(null)).toBeNull();
  });

  it('extractVat: explicit sum without kopecks "- 3451 руб" (L90)', () => {
    // no sumMatch (no decimal), no rate → sumNoFrac branch.
    expect(extractVat('оплата НДС - 3451 руб', 100000)).toBe(3451);
  });
});

// ── classify: null-coalescing on inputs ────────────────────────────────────
describe('classifyRow — nullish inputs (L17,L18)', () => {
  it('null documentLine → coalesces to empty (L17)', () => {
    expect(classifyRow(null as never, '60')).toEqual({
      kind: 'excluded',
      excludeReason: 'supplier',
    });
  });
  it('null corrAccount → coalesces to empty → corr_other (L18)', () => {
    expect(classifyRow('Поступление на расчетный счет 0000-1 от ...', null as never)).toEqual({
      kind: 'excluded',
      excludeReason: 'corr_other',
    });
  });
});

// ── parser: nullish/skip/empty-doc branches ────────────────────────────────
function cell(map: Record<number, string>): string[] {
  const row = Array.from({ length: 12 }, () => '');
  for (const [i, v] of Object.entries(map)) row[Number(i)] = v;
  return row;
}

describe('parseAccountCard — uncovered branches', () => {
  it('returns [] when start marker absent (L31)', () => {
    const sheet: string[][] = [cell({ 0: 'просто шапка' }), cell({ 0: 'Обороты за период' })];
    expect(parseAccountCard(sheet)).toEqual([]);
  });

  it('tolerates undefined rows and coalesces missing cells (L27,L35,L36,L37,L39,L44,L48,L59,L70)', () => {
    // Holes (undefined rows) in both the marker-scan loop and the operation loop.
    const sheet = [
      undefined, // 0 hole → marker loop sheet[i] ?? [] (L27)
      cell({ 0: 'Сальдо на начало' }), // 1 start marker
      undefined, // 2 hole → op loop sheet[i] ?? [] (L35);
      //   row=[], document='' (L36), corr='' (L37),
      //   both empty → continue (L39 both-true skip)
      // payment row with NO doc number and NO col[3] analytics:
      //   externalId '' (L44 ?? ''), col3 '' (L48 ?? ''),
      //   paymentOrderNumber null (L59 || null), no_doc_number problem (L70)
      (() => {
        const r = Array.from({ length: 12 }, () => '') as unknown[];
        r[0] = '01.06.2026';
        r[1] = 'Поступление на расчетный счет без номера';
        r[3] = undefined; // analyticsCr undefined → L48
        r[5] = '14800';
        r[7] = '62.01';
        return r;
      })(),
      // empty document but corr present → L39 first-true/second-false (not skipped)
      cell({ 7: '76.05' }),
      cell({ 0: 'Обороты за период' }), // end marker
    ] as unknown as string[][];

    const rows = parseAccountCard(sheet);
    // The no-number payment row + the empty-doc/corr row survive; the two holes are skipped.
    expect(rows).toHaveLength(2);

    const payment = rows.find((r) => r.kind === 'payment')!;
    expect(payment.externalId).toBe(''); // L44
    expect(payment.paymentOrderNumber).toBeNull(); // L59
    expect(payment.accountCandidates).toEqual([]); // col3 '' (L48)
    expect(payment.parseError).toContain('no_doc_number'); // L70

    const other = rows.find((r) => r.kind === 'excluded')!;
    expect(other.excludeReason).toBe('corr_other');
  });
});

// ── read-spreadsheet: cellToString variants + empty-sheet guards ────────────
describe('readSpreadsheet — cellToString variants (L13,L14,L15-27) + guards (L32,L47)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('xlsx path renders Date/number/boolean/richText/formula/hyperlink/error cells', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Лист1');
    const row = ws.getRow(1);
    row.getCell(1).value = null; // null → '' (L12/L13 left-true)
    row.getCell(2).value = 'строка'; // string (L13 left-false)
    row.getCell(3).value = 42; // number (L14 number)
    row.getCell(4).value = true; // boolean (L14 boolean)
    row.getCell(5).value = new Date(Date.UTC(2026, 5, 1)); // Date (L15-19)
    row.getCell(6).value = { richText: [{ text: 'бо' }, { text: 'гат' }] } as never; // richText (L22)
    row.getCell(7).value = { formula: 'A1', result: 7 } as never; // result (L23)
    row.getCell(8).value = { text: 'ссылка', hyperlink: 'https://x' } as never; // text (L24)
    row.getCell(9).value = { error: '#REF!' } as never; // object fallback (L26)
    row.commit();

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const grid = await readSpreadsheet(buf, 'card.xlsx');

    expect(grid[0][0]).toBe('');
    expect(grid[0][1]).toBe('строка');
    expect(grid[0][2]).toBe('42');
    expect(grid[0][3]).toBe('true');
    // Date branch (L15-19): assert the DD.MM.YYYY shape — ExcelJS serial→Date base is env-independent
    // for the format but the exact day can shift by tz; the branch is what we cover.
    expect(grid[0][4]).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(grid[0][5]).toBe('богат');
    expect(grid[0][6]).toBe('7');
    expect(grid[0][7]).toBe('ссылка');
    // error cell → { error: '#REF!' }: object with no richText/result/text → String() fallback (L26)
    expect(grid[0][8]).toBe('[object Object]');
  });

  it('xlsx path returns [] when workbook has no worksheet (L32)', async () => {
    (loadXlsxWorkbook as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      worksheets: [],
    } as never);
    const grid = await readSpreadsheet(Buffer.from('irrelevant'), 'card.xlsx');
    expect(grid).toEqual([]);
  });

  it('xls path returns [] when workbook has no sheet (L47)', async () => {
    (XLSX.read as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      SheetNames: [],
      Sheets: {},
    } as never);
    const grid = await readSpreadsheet(Buffer.from('irrelevant'), 'card.xls');
    expect(grid).toEqual([]);
  });
});

// ── matcher: baseDto branches on exact route + order-without-inn queue ──────
function row(over: Partial<ParsedRow>): ParsedRow {
  return {
    rowIndex: 1,
    kind: 'payment',
    externalId: '0000-1',
    paidAt: '2026-06-01T00:00:00.000Z',
    amount: 14800,
    isRefund: false,
    purpose: 'Оплата',
    paymentOrderNumber: '0000-1',
    accountCandidates: [],
    counterpartyName: null,
    counterpartyInn: null,
    vatAmount: null,
    rawRow: [],
    ...over,
  };
}
function db(overrides: Record<string, unknown>) {
  return {
    order: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    ...overrides,
  } as never;
}

describe('matchRow — uncovered branches', () => {
  it('exact-by-INN refund with null purpose/paymentOrderNumber exercises baseDto (L22,L23,L24)', async () => {
    const prisma = db({
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: 'org2', inn: '9909676723' }) },
    });
    const out = await matchRow(
      prisma,
      row({
        isRefund: true, // method: 'возврат' branch (L22)
        purpose: null, // purpose ?? undefined (L23)
        paymentOrderNumber: null, // paymentOrderNumber ?? undefined (L24)
        counterpartyInn: '9909676723',
      })
    );
    expect(out.route).toBe('exact');
    if (out.route === 'exact') {
      expect(out.dto.organizationInn).toBe('9909676723');
      expect(out.dto.method).toBe('возврат');
      expect(out.dto.purpose).toBeUndefined();
      expect(out.dto.paymentOrderNumber).toBeUndefined();
      expect(out.dto.isRefund).toBe(true);
    }
  });

  it('order matched but no externalId and org has no inn → queue with candidateOrderId (L50 false, L52-53)', async () => {
    const prisma = db({
      order: {
        findFirst: vi
          .fn()
          .mockResolvedValue({
            id: 'o1',
            externalId: null,
            organizationId: 'org1',
            organization: null,
          }),
      },
    });
    const out = await matchRow(prisma, row({ accountCandidates: ['260509-1905'] }));
    expect(out.route).toBe('queue');
    if (out.route === 'queue') {
      expect(out.candidateOrgId).toBe('org1');
      expect(out.candidateOrderId).toBe('o1');
      expect(out.matchMethod).toBe('name_fuzzy');
    }
  });
});
