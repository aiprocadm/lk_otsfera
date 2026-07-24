import type { EnrollmentStatus } from '@prisma/client';

/**
 * Русские подписи статусов заявки на обучение — единый источник для бейджа
 * (клиент), статусной ленты и текстов уведомлений (сервер). Лента конвейера:
 * «подана → принята → зачислены → идёт обучение → удостоверения готовы».
 */
export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  pending: 'На рассмотрении',
  approved: 'Принята',
  rejected: 'Отклонена',
  provisioned: 'Зачислены',
  in_training: 'Идёт обучение',
  certificates_ready: 'Удостоверения готовы'
};

export function enrollmentStatusLabel(status: EnrollmentStatus): string {
  return ENROLLMENT_STATUS_LABEL[status];
}
