import React from 'react';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import type { Crumb } from '@/lib/navigation/breadcrumbs';

/**
 * Шапка экрана (`У-120`): крошки → заголовок → подзаголовок → главная кнопка.
 *
 * **Зачем компонент.** Эти четыре вещи собирались на каждой странице руками, и
 * расходились ровно так, как расходится всё скопированное: заголовок был то
 * `font-bold`, то `font-semibold` (48 экранов против 41 — на глаз одно и то же,
 * в вёрстке разное), подзаголовок то был, то нет, а главная кнопка вставала то
 * справа от заголовка, то под ним. Правило трёх вопросов (§15) при этом
 * держалось только сторожем по исходникам — то есть на слово.
 *
 * Теперь ответы на «где я», «что здесь делают» и «что делать дальше» живут в
 * одном месте, а сторож проверяет использование компонента, а не разметку.
 *
 * Подзаголовок обязателен намеренно: экран без ответа «что здесь делают» — это
 * дефект приёмки (§15), а не вопрос вкуса. Исключение одно и оно
 * содержательное — карточка сущности: под именем человека или номером заказа
 * стоят его же реквизиты, и выдуманная строка там мешает. Такой экран передаёт
 * `subtitle={null}` **осознанно**, и это видно в коде.
 */
export function PageHeader({
  title,
  subtitle,
  action,
  breadcrumbs,
}: {
  title: React.ReactNode;
  /**
   * Одна строка простыми словами: что здесь делают. `null` — только карточка
   * сущности, где подзаголовок заменяют её собственные реквизиты.
   */
  subtitle: React.ReactNode | null;
  /** Главная кнопка экрана — ответ на вопрос «что делать дальше». */
  action?: React.ReactNode;
  breadcrumbs?: Crumb[] | undefined;
}) {
  return (
    <div className="mb-4">
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className={breadcrumbs && breadcrumbs.length > 0 ? 'mt-1' : undefined}>
          <h1 className="text-2xl font-semibold text-[#111111]">{title}</h1>
          {subtitle !== null && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
