/**
 * Поиск колонок карточки счёта 51 **по заголовкам** (`У-56`).
 *
 * Раньше индексы были прибиты гвоздями (`COL`), и файл из другой конфигурации
 * 1С разбирался в мусор: колонка «Дебет» уезжала на соседнюю позицию, суммы и
 * даты не находились, и весь файл превращался в «ошибки разбора».
 *
 * Жёсткие индексы остались **запасным вариантом** — если заголовки не
 * распознаны, поведение ровно прежнее (это тоже требование `У-56`).
 */
type CardColumns = {
  date: number;
  document: number;
  analyticsCr: number;
  debit: number;
  corr: number;
  credit: number;
};

/** Прежние жёсткие индексы — запасной вариант (наружу не нужны, knip следит). */
const FALLBACK_COLUMNS: CardColumns = {
  date: 0,
  document: 1,
  analyticsCr: 3,
  debit: 5,
  corr: 7,
  credit: 8,
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

/**
 * Заголовки, по которым узнаём колонку. Проверяются в порядке объявления, так
 * что более точные («аналитика кт») стоят раньше общих.
 */
const HEADER_PATTERNS: Array<{ field: keyof CardColumns; re: RegExp }> = [
  { field: 'date', re: /^(период|дата)$/ },
  { field: 'document', re: /^документ$/ },
  { field: 'analyticsCr', re: /^аналитика кт/ },
  { field: 'corr', re: /^(корр\.? ?сч[ет]+|счет кт|счет дт|кор\.? ?счет)$/ },
  { field: 'debit', re: /^дебет$/ },
  { field: 'credit', re: /^кредит$/ },
];

/**
 * Ищем строку заголовков среди первых `limit` строк листа: это строка, где
 * нашлись минимум «Документ» и одна из сумм. Заголовки 1С часто разъезжаются
 * по двум-трём строкам из-за объединённых ячеек, поэтому подписи собираем
 * с самой строки и со следующей.
 */
export function detectColumns(sheet: string[][], limit = 20): ColumnDetection {
  const scanTo = Math.min(sheet.length, limit);

  /** Подписи одной строки листа → поля. */
  function collect(
    rowIndexes: number[],
    into: Partial<Record<keyof CardColumns, number>>
  ): Partial<Record<keyof CardColumns, number>> {
    for (const r of rowIndexes) {
      const row = sheet[r];
      if (!row) continue;
      row.forEach((raw, i) => {
        const value = norm(raw);
        if (!value) return;
        for (const { field, re } of HEADER_PATTERNS) {
          // Первое совпадение выигрывает: «Дебет» из шапки важнее, чем то же
          // слово, встреченное ниже в подписи итогов.
          if (into[field] === undefined && re.test(value)) into[field] = i;
        }
      });
    }
    return into;
  }

  function enough(m: Partial<Record<keyof CardColumns, number>>): boolean {
    return m.document !== undefined && (m.debit !== undefined || m.credit !== undefined);
  }

  function result(r: number, matched: Partial<Record<keyof CardColumns, number>>): ColumnDetection {
    return {
      columns: {
        date: matched.date ?? FALLBACK_COLUMNS.date,
        // `result()` зовётся только после `enough(matched)`, а он требует
        // найденный «Документ» — поэтому здесь значение заведомо есть.
        document: matched.document!,
        analyticsCr: matched.analyticsCr ?? FALLBACK_COLUMNS.analyticsCr,
        debit: matched.debit ?? FALLBACK_COLUMNS.debit,
        corr: matched.corr ?? FALLBACK_COLUMNS.corr,
        credit: matched.credit ?? FALLBACK_COLUMNS.credit,
      },
      source: 'headers',
      headerRow: r,
      matched,
    };
  }

  // Проход 1 — заголовки целиком в одной строке (обычный случай). Идёт первым,
  // иначе «шапка + следующая строка» находилась бы на строку раньше настоящей.
  for (let r = 0; r < scanTo; r++) {
    const matched = collect([r], {});
    if (enough(matched)) return result(r, matched);
  }

  // Проход 2 — заголовки разъехались по двум строкам (объединённые ячейки 1С).
  for (let r = 0; r < scanTo - 1; r++) {
    const matched = collect([r, r + 1], {});
    if (enough(matched)) return result(r + 1, matched);
  }

  return { columns: FALLBACK_COLUMNS, source: 'fallback', headerRow: null, matched: {} };
}
