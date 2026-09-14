import React from 'react';
import { Badge } from '@/components/ui';
import { DIALOG_STATUS_LABELS, type DialogStatus } from '@/lib/services/messengers/dialogStatus';

/**
 * Состояние диалога одним бейджем (`У-207`) — один вид в списке и в карточке
 * (§0.2 «правило зеркала»).
 *
 * Горит только ожидание ответа сотрудника: просрочка по SLA компании —
 * красным, приближение к ней — жёлтым. «Ждём клиента» и «Закрыт» спокойные:
 * там от нас ничего не требуется. У нового диалога без переписки бейджа нет —
 * показывать «Новый» рядом с пустой лентой нечего.
 */
export function DialogStatusBadge({
  status,
  overdue,
}: {
  status: DialogStatus;
  overdue: 'none' | 'warning' | 'overdue';
}) {
  if (status === 'waiting_staff') {
    const tone = overdue === 'overdue' ? 'danger' : overdue === 'warning' ? 'warning' : 'info';
    const suffix = overdue === 'overdue' ? ' · просрочен' : '';
    return <Badge tone={tone}>{`${DIALOG_STATUS_LABELS.waiting_staff}${suffix}`}</Badge>;
  }
  if (status === 'closed') return <Badge tone="neutral">{DIALOG_STATUS_LABELS.closed}</Badge>;
  if (status === 'waiting_client')
    return <Badge tone="neutral">{DIALOG_STATUS_LABELS.waiting_client}</Badge>;
  return null;
}
