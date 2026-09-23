import React from 'react';
import { Badge } from '@/components/ui';
import { moscowDaysUntil } from '@/lib/tasks/due';

/**
 * Подпись срока удостоверения — по московским дням (прогон сопровождения №36,
 * `Р-М-3`), тем же правилом сроков, что и статус реестра (`lib/tasks/due.ts`).
 *
 * Было `Math.ceil((срок − сейчас) / сутки)` от текущего МОМЕНТА: срок хранится
 * полуночью UTC (03:00 МСК), и ночью с 00:00 до 03:00 по Москве удостоверение,
 * истёкшее вчера, получало `ceil(-0.9) = -0` и подпись «Истекает через 0 дн.»,
 * а срок «сегодня» — «через 1 дн.».
 */
export function expiryLabel(validUntil: Date | null, today: Date): string {
  if (!validUntil) return 'Бессрочно';
  const days = moscowDaysUntil(validUntil, today);
  if (days < 0) return 'Просрочено';
  return `Истекает через ${days} дн.`;
}

export function CertificateBadge({ validUntil, today }: { validUntil: Date | null; today: Date }) {
  const label = expiryLabel(validUntil, today);
  const tone =
    label === 'Просрочено' ? 'danger' : label.startsWith('Истекает') ? 'warning' : 'neutral';
  return <Badge tone={tone}>{label}</Badge>;
}
