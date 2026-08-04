import { classifyRow } from './classify';
import {
  parseRusDate,
  parseAmount,
  extractDocNumber,
  extractAccountCandidates,
  extractCounterparty,
  extractInn,
  extractVat,
} from './extractors';
import type { ParsedRow } from './types';

const START_MARKER = /Сальдо\s+на\s+начало/i;
const END_MARKER = /Обороты\s+за\s+период/i;

// Индексы колонок карточки счёта 51.
const COL = { date: 0, document: 1, analyticsCr: 3, debit: 5, corr: 7, credit: 8 } as const;

// Callers always pass a guaranteed string (`document ?? ''`), so the `?? ''`
// nullish fallbacks are unreachable defensive guards.
/* v8 ignore next 2 */
function firstLine(s: string): string {
  return (s ?? '').split('\n')[0]!.trim(); // split всегда даёт минимум один элемент
}
function restLines(s: string): string {
  return (s ?? '').split('\n').slice(1).join('\n').trim();
}

/**
 * Карточка счёта 51 (как string[][]) → нормализованные строки-операции.
 * Срез по маркерам «Сальдо на начало» … «Обороты за период» (устойчив к сдвигу
 * номеров строк шапки). Каждая строка классифицируется и распознаётся; нечитаемая
 * строка получает parseError, но не валит остальные (§3 degrade gracefully).
 */
export function parseAccountCard(sheet: string[][]): ParsedRow[] {
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
  if (start === -1) return [];

  const out: ParsedRow[] = [];
  for (let i = start + 1; i < end; i++) {
    const row = sheet[i] ?? [];
    const document = row[COL.document] ?? '';
    const corr = (row[COL.corr] ?? '').trim();
    // Пустые/служебные строки внутри среза пропускаем.
    if (!document.trim() && !corr) continue;

    const docLine = firstLine(document);
    const purpose = restLines(document) || null;
    const { kind, excludeReason } = classifyRow(docLine, corr);
    const externalId = extractDocNumber(docLine) ?? '';
    const isRefund = kind === 'refund';
    const amount = isRefund ? parseAmount(row[COL.credit]) : parseAmount(row[COL.debit]);
    const paidAt = parseRusDate(row[COL.date]);
    const col3 = row[COL.analyticsCr] ?? '';

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
      if (problems.length) base.parseError = problems.join(',');
    }
    out.push(base);
  }
  return out;
}
