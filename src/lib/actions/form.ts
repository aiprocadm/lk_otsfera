/**
 * Общие помощники server-actions (фаза 2 «гигиена»): один источник вместо
 * копий в calendar/deals/funnel/intake/tasks/requisites (jscpd-кластер).
 * `revalidate()`-хелперы остаются локальными — пути у каждого домена свои.
 */

/** Стандартный Result server-action (зеркалит Result-контракт сервисов, §3). */
export type ActionResult<E extends string> = { ok: true } | { ok: false; error: E };

/** Строковое поле FormData; не-строка (File/null) → '' — как в исходных копиях. */
export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}
