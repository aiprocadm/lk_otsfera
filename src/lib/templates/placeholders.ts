/**
 * Движок подстановок в текстах, редактируемых из интерфейса.
 *
 * Заведён этапом 6 (`У-160`), когда подстановки понадобились второму месту —
 * текстам договора. До этого он жил внутри реестра писем (`У-128`). Копировать
 * его вторым файлом нельзя: две копии разъедутся на первой же правке, а порог
 * повторов в сборке (`jscpd`, §12b) такого и не разрешит.
 *
 * **Здесь только механика, без политики.** «Что делать с пустым значением» —
 * решение места, а не движка: в письме «Заказ —» читается как «номера нет», а
 * в договоре «действует до —» означало бы бумагу без срока. Поэтому прочерки
 * подставляет вызывающий, а движок берёт карту готовых значений.
 */

/** Подстановка: как пишется в тексте, что за поле данных, что это по-русски. */
export type TemplatePlaceholder = {
  /** Как пишется в тексте: `{{order.number}}` → `order.number`. */
  token: string;
  /** Имя поля в данных: имена писались программистами и наружу не годятся. */
  prop: string;
  /** Что это, по-русски — показывается рядом с редактором. */
  label: string;
};

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Все подстановки, встреченные в тексте, в порядке появления и с повторами. */
export function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => m[1]!);
}

export type UnknownPlaceholders = { ok: true } | { ok: false; unknown: string[] };

/**
 * Проверка «нет ли в тексте подстановки, которой не существует».
 *
 * Неизвестная подстановка — отказ сохранить, а не дыра в готовом документе:
 * письмо с пустым местом вместо номера заказа хуже, чем отказ сохранить, а
 * договор — тем более.
 */
export function findUnknownPlaceholders(
  allowed: Iterable<string>,
  ...texts: string[]
): UnknownPlaceholders {
  const known = new Set(allowed);
  const unknown = [...new Set(texts.flatMap(extractPlaceholders))].filter((t) => !known.has(t));
  return unknown.length === 0 ? { ok: true } : { ok: false, unknown };
}

export type MissingPlaceholders = { ok: true } | { ok: false; missing: string[] };

/**
 * Проверка «на месте ли обязательные подстановки».
 *
 * Нужна там, где значение больше нигде в документе не печатается: срок
 * действия договора живёт ровно в одном абзаце, и текст без `{{contract.term}}`
 * молча превратил бы срочный договор в бессрочный.
 */
export function findMissingPlaceholders(
  required: Iterable<string>,
  text: string
): MissingPlaceholders {
  const present = new Set(extractPlaceholders(text));
  const missing = [...required].filter((t) => !present.has(t));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * Подстановка значений по карте «токен → готовая строка».
 *
 * Значения приходят уже готовыми: движок ничего не форматирует и не
 * додумывает. Токен, которого нет в карте, остаётся в тексте как есть — до
 * сюда такой текст не доходит, потому что сохранение уже отказало, но молча
 * съедать его нельзя: пропажа куска текста хуже видимой `{{опечатки}}`.
 */
export function applyPlaceholders(text: string, values: ReadonlyMap<string, string>): string {
  return text.replace(TOKEN_RE, (whole, token: string) => values.get(token) ?? whole);
}
