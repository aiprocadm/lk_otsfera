import React from 'react';
import type { LeadStatus } from '@prisma/client';

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Новая',
  in_review: 'На рассмотрении',
  qualified: 'Квалифицирована',
  promoted_to_order: 'Стала заказом',
  rejected: 'Отклонена'
};

const STATUS_TONE: Record<LeadStatus, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  in_review: 'bg-amber-50 text-amber-800 border-amber-200',
  qualified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  promoted_to_order: 'bg-[#FFF7ED] text-[#9A3412] border-[#FED7AA]',
  rejected: 'bg-gray-100 text-gray-600 border-gray-200'
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-full ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function leadStatusLabel(status: LeadStatus): string {
  return STATUS_LABEL[status];
}
