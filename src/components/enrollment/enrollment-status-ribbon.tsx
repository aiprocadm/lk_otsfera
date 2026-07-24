import React from 'react';
import type { EnrollmentStatus } from '@prisma/client';
import { ENROLLMENT_STATUS_LABEL } from '@/lib/services/enrollments/labels';
import { ENROLLMENT_PIPELINE } from '@/lib/services/enrollments/lifecycle';

/**
 * Статусная лента заявки (этап 2 PR-2, ФТ-2.3): 5 точек конвейера
 * «подана → принята → зачислены → идёт обучение → удостоверения готовы».
 * Отклонённая заявка показывается отдельной плашкой с причиной вместо ленты.
 */
export function EnrollmentStatusRibbon({
  status,
  rejectedReason
}: {
  status: EnrollmentStatus;
  rejectedReason?: string | null;
}) {
  if (status === 'rejected') {
    return (
      <div className='text-sm text-red-800 bg-red-50 border border-red-100 rounded-lg px-3 py-2'>
        Заявка отклонена{rejectedReason ? `: ${rejectedReason}` : ''}
      </div>
    );
  }
  const currentIdx = ENROLLMENT_PIPELINE.indexOf(status);
  return (
    <ol className='flex flex-wrap items-start gap-x-1 gap-y-2' aria-label='Статус заявки'>
      {ENROLLMENT_PIPELINE.map((step, i) => {
        const reached = i <= currentIdx;
        const current = i === currentIdx;
        return (
          <li key={step} className='flex items-start' aria-current={current ? 'step' : undefined}>
            {i > 0 && (
              <span
                aria-hidden
                className={`mt-2 h-0.5 w-6 sm:w-10 rounded ${reached ? 'bg-[#F97316]' : 'bg-gray-200'}`}
              />
            )}
            <span className='flex flex-col items-center w-20 sm:w-24 text-center'>
              <span
                aria-hidden
                className={`h-4 w-4 rounded-full border-2 ${
                  reached ? 'bg-[#F97316] border-[#F97316]' : 'bg-white border-gray-300'
                } ${current ? 'ring-2 ring-orange-200' : ''}`}
              />
              <span className={`mt-1 text-[11px] leading-tight ${reached ? 'text-[#111111] font-medium' : 'text-gray-400'}`}>
                {ENROLLMENT_STATUS_LABEL[step]}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
