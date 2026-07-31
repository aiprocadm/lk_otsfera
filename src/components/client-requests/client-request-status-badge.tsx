import React from 'react';
import type { ClientRequestStatus } from '@prisma/client';
import { CLIENT_REQUEST_STATUS_LABEL as LABEL } from '@/lib/services/clientRequests/labels';

const TONE: Record<ClientRequestStatus, string> = {
  submitted: 'bg-amber-50 text-amber-800 border-amber-200',
  in_triage: 'bg-blue-50 text-blue-700 border-blue-200',
  converted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-gray-100 text-gray-600 border-gray-200',
};

/** Бейдж статуса обращения клиента (этап 5) — по образцу enrollment-status-badge. */
export function ClientRequestStatusBadge({ status }: { status: ClientRequestStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-full ${TONE[status]}`}
    >
      {LABEL[status]}
    </span>
  );
}

export function clientRequestStatusBadgeLabel(status: ClientRequestStatus): string {
  return LABEL[status];
}
