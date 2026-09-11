/**
 * Нарушение уникального ограничения базы (`P2002`) по названному полю.
 *
 * Проверка «занято?» перед записью — для дружелюбного текста, а не защита:
 * в Read Committed две транзакции не видят незакоммиченных строк друг друга,
 * поэтому обе проходят проверку, а на записи вторая получает `P2002`. Если его
 * не разобрать, человек видит падение вместо подготовленной подсказки
 * (сопровождение, прогоны №22–№23: хотфиксы №35—№38).
 *
 * `meta.target` у Postgres приходит то именем ограничения (`User_email_key`),
 * то списком полей (`['organizationId','email']`) — сводим к строке и ищем
 * подстроку. Чужое ограничение не наше дело: вызывающий пробрасывает ошибку
 * дальше, чтобы не спрятать настоящий сбой.
 */
export function isUniqueViolationOn(e: unknown, field: string): boolean {
  if (!e || typeof e !== 'object' || (e as { code?: string }).code !== 'P2002') return false;
  const target = (e as { meta?: { target?: unknown } }).meta?.target;
  const asText = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return asText.toLowerCase().includes(field.toLowerCase());
}
