/**
 * Поиск колонок карточки счёта 51 **по заголовкам** (`У-56`).
 *
 * Раньше индексы были прибиты гвоздями, и файл из другой конфигурации 1С
 * разбирался в мусор. Жёсткие индексы остались **запасным вариантом** — если
 * заголовки не распознаны, поведение ровно прежнее (это тоже требование `У-56`).
 *
 * Главная тонкость живой выгрузки (проверено на реальном файле 10.08.2026):
 * шапка занимает ДВЕ строки, а под «Дебет» и «Кредит» есть подколонка «Счет»:
 *
 * ```
 * Период | Документ | Аналитика Дт | Аналитика Кт | Дебет |   |   | Кредит |   |
 *        |          |              |              | Счет  |   |   | Счет   |   |
 * ```
 *
 * То есть в колонке «Дебет» лежит НЕ сумма, а счёт (51), сумма — в следующей.
 * Из этой же пары берётся корр-счёт: у поступления это «Счет Кт», у списания —
 * «Счет Дт» (второй в паре всегда 51 — сам расчётный счёт).
 */
/** Наружу отдаётся только `ColumnDetection` — сам тип колонок внутренний. */
type CardColumns = {
  date: number;
  document: number;
  analyticsDt: number;
  analyticsCr: number;
  /** Колонка «Счет» под «Дебет» (может отсутствовать). */
  debitAccount: number | null;
  debitAmount: number;
  /**
   * Колонка «Счет» под «Кредит». Если её нет, остаётся прежний индекс: это
   * последний рубеж, откуда парсер берёт корр-счёт, поэтому не `null`.
   */
  creditAccount: number;
  creditAmount: number;
  /**
   * Отдельная колонка «Корр. счет», если она есть в выгрузке. Тогда корр-счёт
   * берётся из неё в обе стороны, а пара «Счет Дт / Счет Кт» не нужна.
   */
  corrAccount: number | null;
};

/** Прежние жёсткие индексы — запасной вариант (наружу не нужны, knip следит). */
const FALLBACK_COLUMNS: CardColumns = {
  date: 0,
  document: 1,
  analyticsDt: 2,
  analyticsCr: 3,
  debitAccount: null,
  debitAmount: 5,
  creditAccount: 7,
  creditAmount: 8,
  corrAccount: null,
};

export type ColumnDetection = {
  columns: CardColumns;
  /** `headers` — колонки найдены по заголовкам, `fallback` — взяты жёсткие. */
  source: 'headers' | 'fallback';
  /** Номер строки заголовков (0-based) или `null`, если её не нашли. */
  headerRow: number | null;
  /** Какие поля удалось сопоставить по заголовкам — для диагностики (`У-58`). */
  matched: Partial<Record<keyof CardColumns, number>>;
};

/** Ячейка может прийти дырой (`undefined`) — в реальных файлах это норма. */
function norm(s: string | undefined): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/ё/gi, 'е')
    .trim()
    .toLowerCase();
}

const IS_DATE = /^(период|дата)$/;
const IS_DOCUMENT = /^документ$/;
const IS_ANALYTICS_DT = /^аналитика дт/;
const IS_ANALYTICS_CR = /^аналитика кт/;
const IS_DEBIT = /^дебет$/;
const IS_CREDIT = /^кредит$/;
const IS_ACCOUNT = /^(счет|корр\.? ?счет|кор\.? ?счет)$/;
const IS_CORR = /^(корр\.? ?счет|кор\.? ?счет|счет кт|счет дт)$/;

/**
 * Ищем строку заголовков среди первых `limit` строк: там обязаны быть
 * «Документ» и хотя бы одна из денежных колонок.
 */
export function detectColumns(sheet: string[][], limit = 20): ColumnDetection {
  const scanTo = Math.min(sheet.length, limit);

  for (let r = 0; r < scanTo; r++) {
    const row = sheet[r];
    if (!row) continue;
    const below = sheet[r + 1] ?? [];

    const found: Partial<Record<keyof CardColumns, number>> = {};
    let debitHeader: number | null = null;
    let creditHeader: number | null = null;

    row.forEach((raw, i) => {
      const v = norm(raw);
      if (!v) return;
      if (found.date === undefined && IS_DATE.test(v)) found.date = i;
      if (found.document === undefined && IS_DOCUMENT.test(v)) found.document = i;
      if (found.analyticsDt === undefined && IS_ANALYTICS_DT.test(v)) found.analyticsDt = i;
      if (found.analyticsCr === undefined && IS_ANALYTICS_CR.test(v)) found.analyticsCr = i;
      if (found.corrAccount === undefined && IS_CORR.test(v)) found.corrAccount = i;
      if (debitHeader === null && IS_DEBIT.test(v)) debitHeader = i;
      if (creditHeader === null && IS_CREDIT.test(v)) creditHeader = i;
    });

    if (found.document === undefined || (debitHeader === null && creditHeader === null)) continue;

    /** «Счет» под денежным заголовком ⇒ сумма съезжает на колонку правее. */
    function moneyPair(header: number | null): { account: number | null; amount: number | null } {
      if (header === null) return { account: null, amount: null };
      if (IS_ACCOUNT.test(norm(below[header]))) return { account: header, amount: header + 1 };
      return { account: null, amount: header };
    }

    const debit = moneyPair(debitHeader);
    const credit = moneyPair(creditHeader);

    const columns: CardColumns = {
      date: found.date ?? FALLBACK_COLUMNS.date,
      // Ниже по коду `document` заведомо найден — иначе мы бы уже вышли выше.
      document: found.document,
      analyticsDt: found.analyticsDt ?? FALLBACK_COLUMNS.analyticsDt,
      analyticsCr: found.analyticsCr ?? FALLBACK_COLUMNS.analyticsCr,
      debitAccount: debit.account,
      debitAmount: debit.amount ?? FALLBACK_COLUMNS.debitAmount,
      creditAccount: credit.account ?? FALLBACK_COLUMNS.creditAccount,
      creditAmount: credit.amount ?? FALLBACK_COLUMNS.creditAmount,
      corrAccount: found.corrAccount ?? null,
    };

    const matched: Partial<Record<keyof CardColumns, number>> = { ...found };
    if (debit.amount !== null) matched.debitAmount = debit.amount;
    if (debit.account !== null) matched.debitAccount = debit.account;
    if (credit.amount !== null) matched.creditAmount = credit.amount;
    if (credit.account !== null) matched.creditAccount = credit.account;

    // Шапка занимает две строки, если под денежным заголовком стоит «Счет»:
    // тело начинается под НИЖНЕЙ строкой.
    const headerRow = debit.account !== null || credit.account !== null ? r + 1 : r;
    return { columns, source: 'headers', headerRow, matched };
  }

  return { columns: FALLBACK_COLUMNS, source: 'fallback', headerRow: null, matched: {} };
}
