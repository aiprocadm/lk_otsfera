import React from 'react';
import { Badge } from '@/components/ui';
import { EXPIRING_WITHIN_DAYS } from '@/lib/services/training/certificates';

/**
 * Статус удостоверения в клиентских реестрах (этап 3, спека §4): считается
 * от `validUntil` на лету — действует (включая бессрочные) / истекает ≤ 60 дн
 * (с точным числом дней) / истекло. Не путать с CertificateBadge менеджера
 * (другая шкала формулировок).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CertificateStatus = 'active' | 'expiring' | 'expired';

export function certificateStatus(validUntil: Date | null, today: Date): CertificateStatus {
  if (!validUntil) return 'active';
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.ceil((validUntil.getTime() - startOfToday.getTime()) / MS_PER_DAY);
  if (days < 0) return 'expired';
  if (days <= EXPIRING_WITHIN_DAYS) return 'expiring';
  return 'active';
}

export function CertificateStatusBadge({
  validUntil,
  today
}: {
  validUntil: Date | null;
  today: Date;
}) {
  const status = certificateStatus(validUntil, today);
  if (status === 'expired') return <Badge tone='danger'>Истекло</Badge>;
  if (status === 'expiring') {
    const startOfToday = new Date(today);
    startOfToday.setHours(0, 0, 0, 0);
    const days = Math.max(0, Math.ceil((validUntil!.getTime() - startOfToday.getTime()) / MS_PER_DAY));
    return <Badge tone='warning'>Истекает через {days} дн.</Badge>;
  }
  return <Badge tone='success'>Действует</Badge>;
}
