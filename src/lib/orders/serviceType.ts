import type { ServiceType } from '@prisma/client';

/** Вид работ по заказу — подписи для форм (этап 6 ТЗ 13.10.2026, `У-306`). */
export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  training: 'Обучение',
  document_development: 'Разработка документов',
};
