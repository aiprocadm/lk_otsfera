import React from 'react';
import { Badge } from '@/components/ui';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function expiryLabel(validUntil: Date | null, today: Date): string {
  if (!validUntil) return 'Бессрочно';
  const days = Math.ceil((validUntil.getTime() - today.getTime()) / MS_PER_DAY);
  if (days < 0) return 'Просрочено';
  return `Истекает через ${days} дн.`;
}

export function CertificateBadge({ validUntil, today }: { validUntil: Date | null; today: Date }) {
  const label = expiryLabel(validUntil, today);
  const tone =
    label === 'Просрочено' ? 'danger' : label.startsWith('Истекает') ? 'warning' : 'neutral';
  return <Badge tone={tone}>{label}</Badge>;
}
