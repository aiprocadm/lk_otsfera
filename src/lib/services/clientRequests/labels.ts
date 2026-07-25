import type { ClientRequestStatus } from '@prisma/client';

/**
 * Русские подписи статусов заявки клиента (этап 5, решение §9-3 спеки) —
 * единый источник для бейджей и текстов уведомлений:
 * «подана → в работе → принята/отклонена».
 */
export const CLIENT_REQUEST_STATUS_LABEL: Record<ClientRequestStatus, string> = {
  submitted: 'Подана',
  in_triage: 'В работе',
  converted: 'Принята',
  rejected: 'Отклонена'
};

export function clientRequestStatusLabel(status: ClientRequestStatus): string {
  return CLIENT_REQUEST_STATUS_LABEL[status];
}
