import type { SourceFilter } from './source';

/**
 * Фильтр периода пакета (`У-200`) для источников, у которых нет серверной
 * фильтрации — `fake` и `file`. Запись без даты создания проходит всегда:
 * лучше показать лишнее в предпросмотре, чем молча потерять строку.
 */
export function inCreatedRange(createdAt: Date | null, filter: SourceFilter): boolean {
  if (!createdAt) return true;
  if (filter.from && createdAt < filter.from) return false;
  if (filter.to && createdAt > filter.to) return false;
  return true;
}
