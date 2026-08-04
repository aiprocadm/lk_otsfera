import type { LeadStatus } from '@prisma/client';

/**
 * Единый источник статусов заявки-лида для UI и валидации query (аудит C1).
 *
 * До этого список статусов был захардкожен тремя копиями (роут, страница,
 * компонент фильтра) и разъехался с prisma-enum: `promoted_to_deal` появился
 * в схеме на этапе 6, но ни в один список не попал — фильтр по нему молча
 * игнорировался, а вкладки его не показывали.
 *
 * Карта подписей ТОТАЛЬНА по `LeadStatus` (`Record<LeadStatus, string>`):
 * новый статус в схеме = ошибка компиляции здесь, а не тихо пропавший пункт.
 * Список и type guard выводятся из неё же — второй копии больше нет.
 *
 * Импорт типовой (`import type`), поэтому рантайм `@prisma/client` в клиентский
 * бандл не тянется; порядок ключей = порядок вкладок в интерфейсе.
 */
export const LEAD_STATUS_FILTER_LABELS_RU: Record<LeadStatus, string> = {
  new: 'Новые',
  in_review: 'На рассмотрении',
  qualified: 'Квалифицированы',
  promoted_to_order: 'Стали заказом',
  // Терминальный статус этапа 6 (ФТ-4.4): лид передан в сделку.
  promoted_to_deal: 'Переданы в сделку',
  rejected: 'Отклонены',
};

export const LEAD_STATUSES = Object.keys(LEAD_STATUS_FILTER_LABELS_RU) as LeadStatus[];

export function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as string[]).includes(value);
}
