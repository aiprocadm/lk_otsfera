import React from 'react';
import Link from 'next/link';
import { buttonClass } from '@/lib/ui/buttonClass';
import { AskQuestionButton } from '@/components/support/ask-question-button';
import type { YourManagerView } from '@/lib/services/organization/yourManager';

/**
 * Блок «Ваш менеджер» на главных заказчика и партнёра (этап 6, `У-240`).
 * Презентационный, один на оба кабинета (`Р-23`): данные и права даёт сервис
 * роли. Показывает имя и e-mail; «Написать» ведёт в переписку с менеджером
 * (`У-234`), а до её появления открывает «Задать вопрос» — тот же диалог
 * кабинета.
 */
export function YourManagerCard({
  view,
  writeHref,
}: {
  view: YourManagerView;
  /** Адрес переписки с менеджером; без него — кнопка «Задать вопрос». */
  writeHref?: string | undefined;
}) {
  const write = writeHref ? (
    <Link href={writeHref} className={buttonClass({ variant: 'primary', size: 'sm' })}>
      Написать
    </Link>
  ) : (
    <AskQuestionButton />
  );
  return (
    <section
      data-testid="your-manager-card"
      className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-[#111111]">Ваш менеджер</h2>
        <p className="text-sm text-gray-500">Кто ведёт ваши заказы и кому писать с вопросами.</p>
      </div>
      {view.manager ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-medium text-[#111111]">{view.manager.name}</div>
            <a
              href={`mailto:${view.manager.email}`}
              className="block truncate text-sm text-[#EA580C] hover:underline"
            >
              {view.manager.email}
            </a>
            {view.othersCount > 0 && (
              <div className="text-xs text-gray-500">
                и ещё {view.othersCount} — по вашим заказам работает несколько сотрудников
              </div>
            )}
          </div>
          {write}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-700">
            Менеджер назначается — напишите нам, и вопрос попадёт к дежурному сотруднику.
          </p>
          {write}
        </div>
      )}
    </section>
  );
}
