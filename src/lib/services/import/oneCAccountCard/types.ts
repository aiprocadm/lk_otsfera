import type { OneCPaymentDto } from '@/lib/services/oneCSync/dto';

export type RowKind = 'payment' | 'refund' | 'excluded';

/** Нормализованная строка-операция из карточки счёта 51. */
export type ParsedRow = {
  rowIndex: number;                 // индекс исходной строки (диагностика)
  kind: RowKind;
  excludeReason?: string;           // при kind==='excluded' (supplier|bank_fee|internal_transfer|corr_other)
  parseError?: string;              // если строку нельзя распарсить (нет суммы/даты)
  externalId: string;               // № документа 1С, напр. '0000-001471'
  paidAt: string | null;            // ISO
  amount: number | null;
  isRefund: boolean;
  purpose: string | null;
  paymentOrderNumber: string | null;
  accountCandidates: string[];      // все извлечённые кандидаты № счёта
  counterpartyName: string | null;
  counterpartyInn: string | null;
  vatAmount: number | null;
  rawRow: string[];                 // исходные ячейки (для очереди/аудита)
};

/** Решение матчера: exact → готовый DTO для writer; queue → кандидат в очередь. */
export type MatchOutcome =
  | { route: 'exact'; dto: OneCPaymentDto }
  | { route: 'queue'; candidateOrgId: string | null; candidateOrderId: string | null; matchMethod: 'name_fuzzy' | 'none' };

export type CardImportCounts = {
  totalRows: number;        // строк-операций (без шапки/итогов)
  imported: number;         // exact → Payment (created+updated)
  refunds: number;          // среди imported — возвраты
  queued: number;           // строк в очередь
  excluded: number;         // corr 60/91/переводы
  excludedByReason: Record<string, number>;
  parseErrors: number;
};

export type CardImportResult = {
  counts: CardImportCounts;
  batchId: string | null;   // null в режиме превью
};
