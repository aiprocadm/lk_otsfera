/**
 * Ссылка на роут выгрузки с активными фильтрами экрана (ФТ-12.1: выгрузка
 * уважает те же фильтры, что и таблица). Пустые/undefined параметры
 * отбрасываются, чтобы href не тащил `?status=&search=`.
 *
 * Этап 9 (PR-3): вынесен из `partner/certificates` и `organization/certificates`,
 * где жил двумя копиями; используется всеми кнопками «Выгрузить в Excel».
 */
export function exportHref(
  base: string,
  params: Record<string, string | undefined>
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}
