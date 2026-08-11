import React from 'react';
import Link from 'next/link';

/**
 * Навигатор задачи на входе в «Обмен с 1С» (`У-47`, этап 7).
 *
 * Раньше корень раздела молча перебрасывал на форму загрузки Excel — человек
 * попадал в форму, не поняв, туда ли он вообще пришёл. Теперь первым делом
 * спрашиваем, ЧТО он хочет сделать, и формулируем это его словами, а не
 * названием формата файла (§15: «что здесь делают» и «что дальше»).
 */
const TASKS = [
  {
    tail: 'excel',
    icon: '🏢',
    question: 'Завести клиентов и заказы из 1С',
    hint: 'Файл выгрузки справочников и заказов. Подходит, когда нужно перенести в систему организации, заказы и документы.',
    action: 'Загрузить файл Excel',
  },
  {
    tail: 'payments',
    icon: '🏦',
    question: 'Разнести оплаты из банка',
    hint: 'Карточка счёта 51 из 1С. Платежи привяжутся к организациям и заказам, непонятные строки уйдут в очередь разбора.',
    action: 'Загрузить выписку',
  },
  {
    tail: 'auto',
    icon: '🔄',
    question: 'Настроить постоянный обмен по сети',
    hint: 'Расписание автоматического обмена, ручной запуск и очереди задач — когда файлы возить руками больше не хочется.',
    action: 'Открыть автообмен',
  },
] as const;

export function OneCNavigator({ cabinet = 'admin' }: { cabinet?: 'admin' | 'leader' }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-[#111111]">Что вы хотите сделать?</h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {TASKS.map((t) => (
          <li key={t.tail}>
            <Link
              href={`/${cabinet}/settings/integrations/1c/${t.tail}`}
              className="flex h-full flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 hover:border-[#F97316] hover:shadow-sm"
            >
              <span aria-hidden className="text-2xl">
                {t.icon}
              </span>
              <span className="text-sm font-medium text-[#111111]">{t.question}</span>
              <span className="text-xs text-gray-500">{t.hint}</span>
              <span className="mt-auto text-sm text-[#F97316]">{t.action} →</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-500">
        Что уже загружали и кем — на вкладке «История»: там же кнопка отмены импорта.
      </p>
    </section>
  );
}
