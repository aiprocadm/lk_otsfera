import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';

/**
 * PR-2 (ФТ-2.1): GET /api/enrollments/import-template — шаблон Excel-импорта
 * слушателей. Гейты флаг/сессия/canSubmitEnrollments + фактическое содержимое
 * xlsx: тело разбирается обратно через exceljs (заголовки колонок, строка-пример).
 */

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { notFoundIfDisabled } = vi.hoisted(() => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

import { GET } from '@/app/api/enrollments/import-template/route';

const organization = { sub: 'o', role: 'organization' } as never;

beforeEach(() => {
  vi.resetAllMocks();
  notFoundIfDisabled.mockReturnValue(null);
});

describe('GET /api/enrollments/import-template', () => {
  it('404 when feature flag disabled', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await GET()).status).toBe(404);
  });

  it('401 unauthenticated', async () => {
    getSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it('403 when role cannot submit enrollments (student)', async () => {
    getSession.mockResolvedValue({ sub: 's', role: 'student' } as never);
    expect((await GET()).status).toBe(403);
  });

  it('успех → 200, spreadsheet content-type, attachment; в теле — заголовки колонок и строка-пример', async () => {
    getSession.mockResolvedValue(organization);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="enrollment-import-template.xlsx"'
    );

    // Разбираем тело обратно: шаблон обязан открываться и содержать колонки ФТ-2.1.
    const wb = new ExcelJS.Workbook();
    // exceljs типизирует load() под DOM ArrayBuffer — отдаём его напрямую, без Buffer-обёртки.
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.worksheets[0];
    expect(ws).toBeDefined();

    const headers: string[] = [];
    ws.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toEqual(['ФИО*', 'Email*', 'Должность', 'СНИЛС', 'Дата рождения', 'Дополнительно']);

    // Строка-пример показывает форматы (СНИЛС с маской, дата ДД.ММ.ГГГГ).
    const example = ws.getRow(2);
    expect(String(example.getCell(1).value)).toBe('Иванов Иван Иванович');
    expect(String(example.getCell(2).value)).toContain('ivanov@example.ru');
    expect(String(example.getCell(4).value)).toBe('123-456-789 00');
    expect(String(example.getCell(5).value)).toBe('01.01.1990');
  });
});
