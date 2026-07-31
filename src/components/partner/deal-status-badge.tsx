import React from 'react';
import type { Stage } from '@/lib/orders/humanStage';

const TONE_CLASSES: Record<Stage['tone'], string> = {
  neutral: 'bg-gray-100 text-gray-700 border-gray-200',
  success: 'bg-green-50 text-green-800 border-green-200',
  warning: 'bg-[#FFF7ED] text-[#9A3412] border-orange-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
};

export function DealStatusBadge({ stage }: { stage: Stage }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${TONE_CLASSES[stage.tone]}`}
    >
      {stage.label}
    </span>
  );
}
