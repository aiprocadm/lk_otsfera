import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';

/**
 * `GET /api/students/import-template` — шаблон Excel для импорта сотрудников
 * (`У-27`, этап 5).
 *
 * Роут отгрузили без единого теста — долг гейта покрытия. Проверяем не «что
 * функция вызвалась», а то, ради чего шаблон существует: он открывается как
 * настоящий xlsx, в нём ровно те колонки, что понимает разбор импорта, и
 * обязательной помечена только ФИО. Разъедься заголовок шаблона с разбором —
 * человек заполнит файл, который система не примет.
 */
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

import { GET } from '@/app/api/students/import-template/route';
import { STUDENT_IMPORT_COLUMNS } from '@/lib/services/students/import';

const manager = { sub: 'm1', role: 'manager' } as never;

/** Разбирает тело ответа обратно в книгу Excel. */
async function readWorkbook(res: Response) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  return wb;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('GET /api/students/import-template (У-27)', () => {
  it('без сессии шаблон не отдаётся', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('вошедшему отдаётся файл, который браузер сохранит, а не покажет', async () => {
    getSession.mockResolvedValue(manager);
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="students-template.xlsx"'
    );
  });

  it('это настоящая книга Excel с листом «Сотрудники»', async () => {
    getSession.mockResolvedValue(manager);
    const wb = await readWorkbook(await GET());

    expect(wb.getWorksheet('Сотрудники')).toBeTruthy();
    expect(wb.creator).toBe('Промтехносфера');
  });

  it('колонки шаблона совпадают с теми, что понимает разбор импорта', async () => {
    getSession.mockResolvedValue(manager);
    const wb = await readWorkbook(await GET());
    const ws = wb.getWorksheet('Сотрудники');
    const headers = (ws?.getRow(1).values as unknown[]).slice(1).map(String);

    // Звёздочка только у ФИО: остальное можно не заполнять (`У-21`).
    expect(headers).toEqual([
      `${STUDENT_IMPORT_COLUMNS.name}*`,
      STUDENT_IMPORT_COLUMNS.position,
      STUDENT_IMPORT_COLUMNS.snils,
      STUDENT_IMPORT_COLUMNS.birthDate,
      STUDENT_IMPORT_COLUMNS.email,
      STUDENT_IMPORT_COLUMNS.phone,
    ]);
    expect(headers.filter((h) => h.endsWith('*'))).toHaveLength(1);
  });

  it('строка-пример показывает формат СНИЛС и даты, а про почту говорит, что она не обязательна', async () => {
    getSession.mockResolvedValue(manager);
    const wb = await readWorkbook(await GET());
    const example = (wb.getWorksheet('Сотрудники')?.getRow(2).values as unknown[])
      .slice(1)
      .map(String);

    expect(example[0]).toBe('Иванов Иван Иванович');
    expect(example[2]).toMatch(/^\d{3}-\d{3}-\d{3} \d{2}$/);
    expect(example[3]).toBe('01.01.1990');
    expect(example[4]).toContain('можно не указывать');
  });

  it('шапка выделена — человек видит, где заканчиваются названия колонок', async () => {
    getSession.mockResolvedValue(manager);
    const wb = await readWorkbook(await GET());
    const cell = wb.getWorksheet('Сотрудники')?.getRow(1).getCell(1);

    expect(cell?.fill).toMatchObject({ type: 'pattern', fgColor: { argb: 'FFF97316' } });
    expect(cell?.font).toMatchObject({ bold: true });
  });
});
