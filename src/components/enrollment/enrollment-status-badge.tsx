import React from 'react';
import type { EnrollmentStatus } from '@prisma/client';
import { ENROLLMENT_STATUS_LABEL as LABEL } from '@/lib/services/enrollments/labels';

const TONE: Record<EnrollmentStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-blue-50 text-blue-700 border-blue-200',
  rejected: 'bg-gray-100 text-gray-600 border-gray-200',
  provisioned: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  in_training: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  certificates_ready: 'bg-green-50 text-green-700 border-green-200'
};

export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-full ${TONE[status]}`}>
      {LABEL[status]}
    </span>
  );
}

export function enrollmentStatusLabel(status: EnrollmentStatus): string {
  return LABEL[status];
}
