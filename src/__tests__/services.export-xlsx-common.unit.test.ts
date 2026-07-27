import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  EXPORT_ROW_LIMIT,
  EXPORT_BRAND_ARGB,
  appendOverflowNotice,
  formatDateRu,
  safeText,
  styleHeader,
  textOrDash
} from '@/lib/services/export/xlsx';

/**
 * Этап 9 PR-3 (ФТ-12.1): общие правила выгрузок Модуля 12 — лимит, защита от
 * формула-инъекций, брендовая шапка, хвост о срезанной выдаче.
 */

function sheet(): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист');
  ws.columns = [
    { header: '№', key: 'num', width: 6 },
    { header: 'Имя', key: 'name', width: 20 }
  ];
  return ws;
}

describe('safeText — защита от формула-инъекций', () => {
  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tтаб', '\rвозврат'])(
    'префиксует опасное начало: %j',
    (raw) => {
      expect(safeText(raw)).toBe(`'${raw}`);
    }
  );

  it('обычный текст не трогает', () => {
    expect(safeText('Иванов Иван')).toBe('Иванов Иван');
    expect(safeText('')).toBe('');
  });
});

describe('formatDateRu / textOrDash', () => {
  it('дата — в русском формате, пустая — прочерк', () => {
    expect(formatDateRu(new Date('2026-03-05T10:00:00Z'))).toBe('05.03.2026');
    expect(formatDateRu(null)).toBe('—');
    expect(formatDateRu(undefined)).toBe('—');
  });

  it('пустая строка/пробелы/null — прочерк, значение — через safeText', () => {
    expect(textOrDash(null)).toBe('—');
    expect(textOrDash(undefined)).toBe('—');
    expect(textOrDash('   ')).toBe('—');
    expect(textOrDash('Инженер')).toBe('Инженер');
    expect(textOrDash('=1+1')).toBe("'=1+1");
  });
});

describe('styleHeader', () => {
  it('красит шапку в бренд, морозит первую строку и ставит автофильтр при наличии строк', () => {
    const ws = sheet();
    styleHeader(ws, true);
    const cell = ws.getRow(1).getCell(1);
    expect((cell.fill as ExcelJS.FillPattern).fgColor?.argb).toBe(EXPORT_BRAND_ARGB);
    expect(cell.font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
  });

  it('без строк автофильтр не ставится', () => {
    const ws = sheet();
    styleHeader(ws, false);
    expect(ws.autoFilter).toBeFalsy();
  });
});

describe('appendOverflowNotice', () => {
  it('молчит, пока total не превысил лимит', () => {
    const ws = sheet();
    const before = ws.rowCount;
    appendOverflowNotice(ws, { total: EXPORT_ROW_LIMIT, noticeKey: 'name' });
    expect(ws.rowCount).toBe(before);
  });

  it('добавляет пустую строку и текст о срезанной выдаче', () => {
    const ws = sheet();
    appendOverflowNotice(ws, { total: EXPORT_ROW_LIMIT + 1, noticeKey: 'name' });
    const last = ws.getRow(ws.rowCount);
    expect(String(last.getCell('name').value)).toBe(
      `Показаны первые ${EXPORT_ROW_LIMIT} строк из ${EXPORT_ROW_LIMIT + 1} — уточните фильтры.`
    );
  });

  it('уважает переданный лимит', () => {
    const ws = sheet();
    appendOverflowNotice(ws, { total: 5, noticeKey: 'name', limit: 2 });
    expect(String(ws.getRow(ws.rowCount).getCell('name').value)).toContain('первые 2 строк из 5');
  });
});
