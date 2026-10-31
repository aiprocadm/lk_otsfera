import React from 'react';
import { Badge } from '@/components/ui';
import type { StatusSteps } from '@/lib/orders/statusSteps';

/**
 * Шкала этапов карточки заказа — статусы из справочника (этап 5 ТЗ 28.10.2026,
 * `У-353`, `В-ТР-4` (1)): пройденные отмечены галочкой, текущий подсвечен.
 * Одна на пять кабинетов (`Р-ТР-6`): у сотрудников шаги приходят с панелью
 * статуса, у заказчика и партнёра — отдельным чтением, без кнопок.
 *
 * Отменённый заказ — пометкой над шкалой: путь, по которому он шёл, остаётся
 * виден. Статус, выключенный в справочнике, — словами, без подсветки шага.
 */
export function OrderStatusStepper({ steps, terminalLabel, offPipelineLabel }: StatusSteps) {
  if (steps.length === 0) return null;
  const last = steps.length - 1;

  return (
    <div className="space-y-2">
      {terminalLabel && (
        <Badge tone="danger" className="text-xs font-medium">
          {terminalLabel}
        </Badge>
      )}
      {offPipelineLabel && (
        <p className="text-xs text-gray-500">
          Текущий статус — «{offPipelineLabel}»: его нет среди этапов справочника.
        </p>
      )}
      <div className="w-full overflow-x-auto">
        <ol aria-label="Этапы заказа" className="flex items-start gap-0 min-w-0">
          {steps.map((step, i) => {
            const isDone = step.state === 'done';
            const isCurrent = step.state === 'current';
            return (
              <li key={step.id} className="flex flex-1 flex-col items-center gap-1 min-w-0">
                <div className="flex items-center w-full">
                  <div
                    className={[
                      'flex-1 h-0.5',
                      i === 0 ? 'invisible' : isDone || isCurrent ? 'bg-orange-400' : 'bg-gray-200',
                    ].join(' ')}
                  />
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
                      i + 1
                    )}
                  </div>
                  <div
                    className={[
                      'flex-1 h-0.5',
                      i === last ? 'invisible' : isDone ? 'bg-orange-400' : 'bg-gray-200',
                    ].join(' ')}
                  />
                </div>
                <span
                  className={[
                    'text-center text-[10px] leading-tight px-0.5 max-w-full break-words',
                    isCurrent
                      ? 'text-orange-600 font-semibold'
                      : isDone
                        ? 'text-gray-600 font-medium'
                        : 'text-gray-400',
                  ].join(' ')}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
