import React from 'react';
import Link from 'next/link';
import type { FirstStepsView } from '@/lib/dashboard/firstSteps';
import { buttonClass } from '@/lib/ui/buttonClass';

/**
 * Блок «Первые шаги» на главных заказчика и партнёра (этап 6, `У-239`).
 * Презентационный, один на оба кабинета (`Р-23`): пункты и их выполненность
 * считает сервис роли, «Закрыть» — server action роли (передаётся снаружи).
 * Пока не выполнено всё и не нажато «Закрыть», блок стоит первым на главной.
 */
export function FirstStepsCard({
  view,
  dismissAction,
  scopeField,
}: {
  view: FirstStepsView;
  /** Server action «Закрыть»: пишет отметку на членстве, не на пользователе. */
  dismissAction: (formData: FormData) => Promise<void>;
  /** Скрытое поле с идентификатором членства (организация / партнёр). */
  scopeField: { name: string; value: string };
}) {
  if (!view.visible) return null;
  return (
    <section
      data-testid="first-steps"
      className="space-y-3 rounded-xl border border-[#F97316]/40 bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-[#111111]">Первые шаги</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Что настроить, чтобы кабинет заработал на вас; выполненное отмечается само.
          </p>
        </div>
        <div className="text-sm text-gray-600" data-testid="first-steps-progress">
          Готово {view.doneCount} из {view.items.length}
        </div>
      </div>
      <ol className="space-y-2">
        {view.items.map((item, idx) => (
          <li
            key={item.key}
            data-testid={`first-step-${item.key}`}
            data-done={item.done ? '1' : '0'}
            className="flex items-start gap-3"
          >
            <span
              aria-hidden
              className={`w-5 flex-shrink-0 text-sm ${item.done ? 'text-green-600' : 'text-gray-400'}`}
            >
              {item.done ? '✓' : `${idx + 1}.`}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={
                  item.done
                    ? 'text-sm text-gray-500 line-through'
                    : 'text-sm font-medium text-[#111111]'
                }
              >
                {item.title}
              </div>
              <div className="text-xs text-gray-500">{item.hint}</div>
            </div>
            {!item.done && (
              <Link
                href={item.href}
                className="flex-shrink-0 text-sm text-[#F97316] hover:underline"
              >
                Перейти →
              </Link>
            )}
          </li>
        ))}
      </ol>
      <form action={dismissAction} className="flex justify-end">
        <input type="hidden" name={scopeField.name} value={scopeField.value} />
        <button
          type="submit"
          className={buttonClass({ variant: 'secondary', size: 'sm' })}
          title="Больше не показывать этот блок"
        >
          Закрыть
        </button>
      </form>
    </section>
  );
}
