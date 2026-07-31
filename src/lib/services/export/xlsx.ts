import type ExcelJS from 'exceljs';

/**
 * Общие правила выгрузок Модуля 12 (ФТ-12.1) в одном месте: лимит строк,
 * защита от формула-инъекций, брендовая шапка, хвост «показаны первые N из M».
 * Раньше это жило копиями в `commission/xlsx.ts` и `certificates/xlsx.ts`;
 * этап 9 (PR-3) добавляет ещё три выгрузки — дублировать в пятый раз нельзя.
 */

/** Потолок строк одной выгрузки — дальше пользователю предлагаем сузить фильтры. */
export const EXPORT_ROW_LIMIT = 10_000;

/** Оранжевый примитивов UI (§13 CLAUDE.md). */
export const EXPORT_BRAND_ARGB = 'FFF97316';

/**
 * OWASP CSV/формула-инъекция: ведущие `= + - @`, таб и CR превращают ячейку в
 * формулу — префиксуем одинарной кавычкой.
 */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Дата в русском формате; пустое значение — прочерк. */
export function formatDateRu(d: Date | null | undefined): string {
  return d ? new Date(d).toLocaleDateString('ru-RU') : '—';
}

/** Строка-значение с прочерком вместо пустоты (ФТ-12.2: пустая должность). */
export function textOrDash(value: string | null | undefined): string {
  const v = value?.trim();
  return v ? safeText(v) : '—';
}

/**
 * Брендовая шапка + заморозка первой строки + автофильтр (последний — только
 * когда есть данные: ExcelJS ставит фильтр на пустой лист некорректно).
 */
export function styleHeader(ws: ExcelJS.Worksheet, hasRows: boolean): void {
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_BRAND_ARGB } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  headerRow.height = 20;
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  if (hasRows) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  }
}

/**
 * Хвост о срезанной выдаче. `noticeKey` — колонка, в которой видно текст
 * (у каждой выгрузки своя вторая колонка).
 */
export function appendOverflowNotice(
  ws: ExcelJS.Worksheet,
  args: { total: number; noticeKey: string; limit?: number }
): void {
  const limit = args.limit ?? EXPORT_ROW_LIMIT;
  if (args.total <= limit) return;
  ws.addRow({});
  ws.addRow({
    [args.noticeKey]: `Показаны первые ${limit} строк из ${args.total} — уточните фильтры.`,
  });
}
