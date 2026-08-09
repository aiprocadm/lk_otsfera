import React, { type ReactNode } from 'react';

/**
 * Карточный вид таблицы на телефоне (`У-18`, этап 3 ТЗ понятности).
 *
 * Правило простое: таблица шире четырёх колонок получает `hidden md:block`, а
 * рядом встаёт `<CardList>` с `md:hidden`. Переключение — **чистый CSS**:
 * никакого JS и определения устройства, поэтому серверный рендер не ломается и
 * оба вида всегда содержат одни и те же данные.
 *
 * Образец, с которого снят шаблон, — `partner/team-table` + `team-card-list`.
 */
export function CardList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={`md:hidden space-y-2 ${className ?? ''}`}>{children}</ul>;
}

/** Одна карточка: заголовок сверху, под ним строки «подпись → значение». */
export function Card({
  title,
  actions,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm text-[#111111] min-w-0">{title}</div>
        {actions ? <div className="flex-shrink-0">{actions}</div> : null}
      </div>
      <dl className="mt-2 space-y-1">{children}</dl>
    </li>
  );
}

/** Строка карточки. Пустое значение показывается прочерком, а не пропадает. */
export function CardRow({ label, children }: { label: string; children?: ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="text-gray-500 flex-shrink-0">{label}</dt>
      <dd className="text-gray-800 text-right min-w-0 break-words">{empty ? '—' : children}</dd>
    </div>
  );
}
