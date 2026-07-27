/**
 * Этап 12 PR-2 (Модуль 5, ФТ-5.3) — подсказка «файл → слушатель» при массовой
 * загрузке сканов удостоверений.
 *
 * ТЗ требует **обязательное ручное подтверждение**, поэтому здесь именно
 * подсказка: функция не привязывает файл к позиции, а предлагает кандидата,
 * который менеджер видит в форме и может сменить. Неоднозначные совпадения
 * помечаются `ambiguous` — форма не подставляет их молча.
 *
 * Чистая функция без БД — юнит-тестируема.
 */

/** Позиция заказа, к которой может относиться скан. */
export type ScanMatchTarget = {
  itemId: string;
  studentName: string;
};

export type ScanMatch = {
  fileName: string;
  /** Предлагаемая позиция; null — совпадений нет или их несколько. */
  suggestedItemId: string | null;
  /** true — совпало больше одной позиции, выбор строго за менеджером. */
  ambiguous: boolean;
};

/**
 * Приводит строку к сравнимому виду: нижний регистр, `ё → е`, всё, кроме
 * букв и цифр, — в пробел. Так «Иванов_И.И.-скан.pdf» и «Иванов И И»
 * сводятся к одному набору слов.
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Слова длиной от 2 символов — инициалы («и», «а») слишком слабый признак. */
function significantWords(value: string): string[] {
  return normalizeName(value)
    .split(' ')
    .filter((w) => w.length >= 2);
}

/**
 * Совпадение считается найденным, если фамилия (первое значимое слово ФИО)
 * встречается среди слов имени файла. Этого достаточно для подсказки — точность
 * добирается ручным подтверждением.
 */
function matches(fileName: string, studentName: string): boolean {
  const surname = significantWords(studentName)[0];
  if (!surname) return false;
  return significantWords(fileName).includes(surname);
}

/** Подсказка по одному файлу. */
export function suggestScanMatch(
  fileName: string,
  targets: ReadonlyArray<ScanMatchTarget>
): ScanMatch {
  const hits = targets.filter((t) => matches(fileName, t.studentName));
  if (hits.length === 1) {
    return { fileName, suggestedItemId: hits[0].itemId, ambiguous: false };
  }
  return { fileName, suggestedItemId: null, ambiguous: hits.length > 1 };
}

/** Подсказки по пачке файлов (порядок сохраняется). */
export function suggestScanMatches(
  fileNames: ReadonlyArray<string>,
  targets: ReadonlyArray<ScanMatchTarget>
): ScanMatch[] {
  return fileNames.map((name) => suggestScanMatch(name, targets));
}
