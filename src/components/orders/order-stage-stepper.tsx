import React from 'react';
import { Badge } from '@/components/ui';
import type { WorkingStage, StageTone } from '@/lib/orders/humanStage';

/**
 * Презентационный 6-шаговый индикатор рабочего статуса заказа (spec §10).
 *
 * При терминальном статусе (cancelled / on_hold) рендерит одиночный Badge
 * вместо дорожки — статус вне обычного цикла.
 *
 * Domain-agnostic: принимает WorkingStage + массив меток (WORKING_STAGE_LABELS).
 * Используй только ui/-примитивы и Tailwind-палитру — без инлайн-hex.
 */

function toneToBadge(tone: StageTone): 'neutral' | 'success' | 'warning' | 'danger' {
  if (tone === 'neutral') return 'neutral';
  if (tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  return 'danger';
}

export function OrderStageStepper({ stage, labels }: { stage: WorkingStage; labels: string[] }) {
  // Терминальный: одиночный бейдж вместо дорожки
  if (stage.terminal) {
    return (
      <Badge tone={toneToBadge(stage.tone)} className="text-xs font-medium">
        {stage.label}
      </Badge>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <ol className="flex items-start gap-0 min-w-0">
        {labels.map((label, i) => {
          const stepIndex = i + 1; // 1..6
          const isDone = stepIndex < stage.index;
          const isCurrent = stepIndex === stage.index;
          // upcoming: stepIndex > stage.index

          return (
            <li key={label} className="flex flex-1 flex-col items-center gap-1 min-w-0">
              {/* Connector line + dot row */}
              <div className="flex items-center w-full">
                {/* Left connector */}
                <div
                  className={[
                    'flex-1 h-0.5',
                    stepIndex === 1
                      ? 'invisible'
                      : isDone || isCurrent
                        ? 'bg-orange-400'
                        : 'bg-gray-200',
                  ].join(' ')}
                />

                {/* Step dot */}
                <div
                  className={[
                    'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                    isCurrent
                      ? 'bg-orange-500 text-white'
                      : isDone
                        ? 'bg-orange-400 text-white'
                        : 'bg-gray-200 text-gray-400',
                  ].join(' ')}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isDone ? (
                    // Checkmark for done steps
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="w-3.5 h-3.5"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    stepIndex
                  )}
                </div>

                {/* Right connector */}
                <div
                  className={[
                    'flex-1 h-0.5',
                    stepIndex === labels.length
                      ? 'invisible'
                      : isDone
                        ? 'bg-orange-400'
                        : 'bg-gray-200',
                  ].join(' ')}
                />
              </div>

              {/* Label */}
              <span
                className={[
                  'text-center text-[10px] leading-tight px-0.5 truncate max-w-full',
                  isCurrent
                    ? 'text-orange-600 font-semibold'
                    : isDone
                      ? 'text-gray-600 font-medium'
                      : 'text-gray-400',
                ].join(' ')}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
