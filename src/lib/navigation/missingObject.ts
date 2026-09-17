/**
 * «Объект недоступен» (этап 5 PR-3, `У-232`, спека §3.7; пакет §9).
 *
 * Ссылка из уведомления может вести на удалённый или закрытый для роли
 * объект. Вместо 404 карточка отправляет человека в список раздела с
 * параметром `?missing=1`, а список показывает объяснение — это тот же
 * ответ и для удалённого, и для чужого объекта, чтобы существование чужого
 * не утекало по разнице ответов (§4).
 */

export const MISSING_OBJECT_PARAM = 'missing';

/** Адрес списка раздела с пометкой «объект недоступен». */
export function missingObjectHref(listPath: string): string {
  const sep = listPath.includes('?') ? '&' : '?';
  return `${listPath}${sep}${MISSING_OBJECT_PARAM}=1`;
}

/** Пришёл ли человек по ссылке на недоступный объект. */
export function isMissingObjectRequested(
  searchParams: Record<string, string | string[] | undefined> | undefined
): boolean {
  const v = searchParams?.[MISSING_OBJECT_PARAM];
  return v === '1' || (Array.isArray(v) && v.includes('1'));
}
