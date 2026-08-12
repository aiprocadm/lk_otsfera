import type { OneCPaymentDto } from '@/lib/services/oneCSync/dto';

export type RowKind = 'payment' | 'refund' | 'excluded';

/** Нормализованная строка-операция из карточки счёта 51. */
export type ParsedRow = {
  rowIndex: number; // индекс исходной строки (диагностика)
  kind: RowKind;
  excludeReason?: string | undefined; // при kind==='excluded' (supplier|bank_fee|internal_transfer|corr_other)
  parseError?: string | undefined; // если строку нельзя распарсить (нет суммы/даты)
  externalId: string; // № документа 1С, напр. '0000-001471'
  paidAt: string | null; // ISO
  amount: number | null;
  isRefund: boolean;
  purpose: string | null;
  paymentOrderNumber: string | null;
  accountCandidates: string[]; // все извлечённые кандидаты № счёта
  counterpartyName: string | null;
  counterpartyInn: string | null;
  vatAmount: number | null;
  rawRow: string[]; // исходные ячейки (для очереди/аудита)
};

/** Решение матчера: exact → готовый DTO для writer; queue → кандидат в очередь. */
export type MatchOutcome =
  | { route: 'exact'; dto: OneCPaymentDto }
  | {
      route: 'queue';
      candidateOrgId: string | null;
      candidateOrderId: string | null;
      matchMethod: 'name_fuzzy' | 'none';
    };

/**
 * «Что система увидела в файле» (`У-58`). Без этого блока пользователь видел
 * только «Ошибок разбора: 129» и не мог понять ни причины, ни что чинить.
 */
export type CardParseDiagnostics = {
  /** Колонки найдены по заголовкам или взяты жёсткие (`У-56`). */
  columnSource: 'headers' | 'fallback';
  headerRow: number | null;
  matchedColumns: Partial<
    Record<'date' | 'document' | 'analyticsCr' | 'debit' | 'corr' | 'credit', number>
  >;
  startMarkerFound: boolean;
  rowsScanned: number;
  /** Сколько строк не разобрано по каждой причине: no_doc_number | no_amount | no_date. */
  parseErrorsByReason: Record<string, number>;
  /** До пяти живых примеров непрочитанных строк — с номером строки в файле. */
  samples: Array<{ rowNumber: number; reasons: string[]; document: string; corr: string }>;
  /** Человеческие замечания к разбору (русский текст, показывается как есть). */
  notes: string[];
};

export type CardImportCounts = {
  totalRows: number; // строк-операций (без шапки/итогов)
  imported: number; // exact → Payment (created+updated)
  refunds: number; // среди imported — возвраты
  queued: number; // строк в очередь
  /**
   * ПОЧЕМУ строки ушли в очередь: `name_fuzzy` — нашли похожую организацию и
   * ждём подтверждения, `none` — не нашли ни счёта, ни ИНН, ни похожего имени.
   * Без этой разбивки «В очередь разбора: 130» не говорит человеку ничего
   * (жалоба 11.08.2026: «так и не работает импорт операций»).
   */
  queuedByReason: Record<string, number>;
  excluded: number; // corr 60/91/переводы
  excludedByReason: Record<string, number>;
  parseErrors: number;
  /** Сколько организаций импорт завёл сам (`У-49`). */
  orgsCreated: number;
};
