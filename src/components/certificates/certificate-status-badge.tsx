import React from 'react';
import { Badge } from '@/components/ui';
import { certificateStatus } from '@/lib/services/training/certificates';
import { moscowDaysUntil } from '@/lib/tasks/due';

/**
 * Статус удостоверения в клиентских реестрах (этап 3, спека §4): считается
 * от `validUntil` на лету — действует (включая бессрочные) / истекает ≤ 60 дн
 * (с точным числом дней) / истекло. Не путать с CertificateBadge менеджера
 * (другая шкала формулировок). Вычисление статуса живёт в сервисе (PR-2:
 * единый источник с xlsx-экспортом); здесь — re-export для потребителей.
 */

export { certificateStatus };

export function CertificateStatusBadge({
  validUntil,
  today,
}: {
  validUntil: Date | null;
  today: Date;
}) {
  const status = certificateStatus(validUntil, today);
  if (status === 'expired') return <Badge tone="danger">Истекло</Badge>;
  // `validUntil !== null`: без срока `certificateStatus` отвечает «действует».
  if (status === 'expiring' && validUntil) {
    // Число дней — московских (прогон №36), тем же правилом, что и статус.
    // Было `setHours(0, 0, 0, 0)` в поясе процесса (сервер в UTC): с 00:00 до
    // 03:00 МСК значок показывал на день больше, чем осталось.
    const days = moscowDaysUntil(validUntil, today);
    return <Badge tone="warning">Истекает через {days} дн.</Badge>;
  }
  return <Badge tone="success">Действует</Badge>;
}
