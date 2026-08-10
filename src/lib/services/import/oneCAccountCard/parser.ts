import { classifyRow } from './classify';
import { detectColumns, type ColumnDetection } from './columns';
import {
  parseRusDate,
  parseAmount,
  extractDocNumber,
  extractAccountCandidates,
  extractCounterparty,
  extractInn,
  extractVat,
} from './extractors';
import type { ParsedRow, CardParseDiagnostics } from './types';

const START_MARKER = /Сальдо\s+на\s+начало/i;
const END_MARKER = /Обороты\s+за\s+период/i;

// Callers always pass a guaranteed string (`document ?? ''`), so the `?? ''`
// nullish fallbacks are unreachable defensive guards.
/* v8 ignore next 3 -- `s ?? ''` недостижим: единственный вызывающий передаёт `firstLine(document)`, где `document = row[cols.document] ?? ''` уже строка */
function firstLine(s: string): string {
  return (s ?? '').split('\n')[0]!.trim(); // split всегда даёт минимум один элемент
}
/* v8 ignore next 3 -- то же самое для restLines: `document` гарантированно строка, ветка `?? ''` — защитный guard */
function restLines(s: string): string {
  return (s ?? '').split('\n').slice(1).join('\n').trim();
}

/** Русские подписи причин, по которым строка не разобралась (`У-58`). */
export const PARSE_ERROR_LABELS: Record<string, string> = {
  no_doc_number: 'не найден номер документа',
  no_amount: 'не найдена сумма',
  no_date: 'не найдена дата',
};

export type ParseResult = { rows: ParsedRow[]; diagnostics: CardParseDiagnostics };

/**
 * Карточка счёта 51 (как string[][]) → нормализованные строки-операции.
 *
 * Колонки ищутся **по заголовкам** (`У-56`); если заголовков нет — берутся
 * прежние жёсткие индексы. Тело таблицы срезается по маркерам «Сальдо на
 * начало» … «Обороты за период»; если маркера начала нет, парсер **не молчит**
 * (`У-57`), а начинает от строки заголовков и говорит об этом в диагностике.
 *
 * Нечитаемая строка получает parseError, но не валит остальные
 * (§3 degrade gracefully).
 */
export function parseAccountCard(sheet: string[][]): ParseResult {
  const detection: ColumnDetection = detectColumns(sheet);
  const cols = detection.columns;

  let start = -1;
  let end = sheet.length;
  for (let i = 0; i < sheet.length; i++) {
    const joined = (sheet[i] ?? []).join(' ');
    if (start === -1 && START_MARKER.test(joined)) {
      start = i;
      continue;
    }
    if (start !== -1 && END_MARKER.test(joined)) {
      end = i;
      break;
    }
  }

  // `У-57`: без «Сальдо на начало» раньше возвращался пустой список — файл
  // выглядел «пустым» без единого слова о причине. Теперь пробуем начать от
  // строки заголовков и сообщаем, что маркера не было.
  const startMarkerFound = start !== -1;
  if (!startMarkerFound) {
    if (detection.headerRow === null) {
      return {
        rows: [],
        diagnostics: {
          columnSource: detection.source,
          headerRow: null,
          matchedColumns: detection.matched,
          startMarkerFound: false,
          rowsScanned: 0,
          parseErrorsByReason: {},
          samples: [],
          notes: [
            'В файле не найдены ни строка «Сальдо на начало», ни заголовки колонок («Документ», «Дебет»/«Кредит»). Похоже, это не карточка счёта 51 — проверьте, тот ли отчёт выгружен.',
          ],
        },
      };
    }
    // Заголовки нашлись — тело начинается сразу под ними (со сдвигом на
    // возможную вторую строку шапки её отсеет проверка пустых строк).
    start = detection.headerRow;
  }

  const out: ParsedRow[] = [];
  const parseErrorsByReason: Record<string, number> = {};
  const samples: CardParseDiagnostics['samples'] = [];

  for (let i = start + 1; i < end; i++) {
    const row = sheet[i] ?? [];
    const document = row[cols.document] ?? '';
    const corr = (row[cols.corr] ?? '').trim();
    // Пустые/служебные строки внутри среза пропускаем.
    if (!document.trim() && !corr) continue;

    const docLine = firstLine(document);
    const purpose = restLines(document) || null;
    const { kind, excludeReason } = classifyRow(docLine, corr);
    const externalId = extractDocNumber(docLine) ?? '';
    const isRefund = kind === 'refund';
    const amount = isRefund ? parseAmount(row[cols.credit]) : parseAmount(row[cols.debit]);
    const paidAt = parseRusDate(row[cols.date]);
    const col3 = row[cols.analyticsCr] ?? '';

    const base: ParsedRow = {
      rowIndex: i,
      kind,
      excludeReason,
      externalId,
      paidAt,
      amount,
      isRefund,
      purpose,
      paymentOrderNumber: externalId || null,
      accountCandidates: extractAccountCandidates(`${purpose ?? ''} ${col3}`),
      counterpartyName: extractCounterparty(col3),
      counterpartyInn: extractInn(`${col3} ${purpose ?? ''}`),
      vatAmount: extractVat(purpose, amount),
      rawRow: row,
    };

    // parseError только для строк, которые мы НАМЕРЕНЫ импортировать (payment/refund).
    if (kind !== 'excluded') {
      const problems: string[] = [];
      if (!externalId) problems.push('no_doc_number');
      if (amount == null) problems.push('no_amount');
      if (!paidAt) problems.push('no_date');
      if (problems.length) {
        base.parseError = problems.join(',');
        for (const p of problems) parseErrorsByReason[p] = (parseErrorsByReason[p] ?? 0) + 1;
        // Несколько примеров живых строк: без них «129 ошибок разбора» не
        // говорит человеку ничего (§15 — ошибка обязана объяснять).
        if (samples.length < 5) {
          samples.push({
            rowNumber: i + 1,
            reasons: problems,
            document: docLine.slice(0, 120),
            corr,
          });
        }
      }
    }
    out.push(base);
  }

  const notes: string[] = [];
  if (!startMarkerFound) {
    notes.push(
      'Строка «Сальдо на начало» не найдена — таблица прочитана от строки заголовков. Проверьте итоговые числа.'
    );
  }
  if (detection.source === 'fallback') {
    notes.push(
      'Заголовки колонок не распознаны — использована стандартная раскладка карточки счёта 51. Если суммы или даты не нашлись, дело почти наверняка в этом.'
    );
  }

  return {
    rows: out,
    diagnostics: {
      columnSource: detection.source,
      headerRow: detection.headerRow,
      matchedColumns: detection.matched,
      startMarkerFound,
      rowsScanned: out.length,
      parseErrorsByReason,
      samples,
      notes,
    },
  };
}
