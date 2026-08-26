import React, { type ReactNode } from 'react';

/**
 * Общий каркас всех шести кабинетов (`У-11`, этап 2 ТЗ понятности).
 *
 * До этапа 2 каркасов было пять (`admin`/`manager`/`leader`/`org` + generic для
 * партнёра и слушателя). Любая правка — мобильная версия, хлебные крошки
 * этапа 9 — означала пять одинаковых правок и пять шансов разойтись.
 *
 * Роль-специфичное приходит **пропсами**, а не ветвлением по роли внутри:
 * заголовок сайдбара, готовый список пунктов, содержимое шапки, мобильная
 * навигация. Гарды и фильтрация прав остаются у вызывающего (CLAUDE.md §4) —
 * каркас ничего не решает про доступ.
 *
 * `У-115`: тёмной темы у каркаса больше **нет**. Она была ровно у одного
 * кабинета (партнёр и слушатель), а ТЗ требует одинаковой шапки — поэтому
 * проп убран целиком, а не переставлен: пока он существует, шапка может
 * разъехаться обратно одной строкой.
 *
 * Этап 3 (`У-17`): отступ под нижнюю панель `pb-16 md:pb-0` живёт **здесь и
 * только здесь** — панель теперь во всех шести кабинетах, поэтому условие не
 * нужно, а дубли по страницам убраны.
 */
export function AppShell(props: {
  /** Готовый сайдбар: обычно `<Sidebar …/>`, у заказчика — своя обёртка с переключателем организаций. */
  sidebar: ReactNode;
  /** Бургер + нижняя панель + выдвижное меню (`<MobileNav …/>`), клиентский. */
  mobileNav?: ReactNode;
  headerLeft: ReactNode;
  headerRight: ReactNode;
  /**
   * Командная палитра Ctrl/Cmd+K (`У-75`, этап 9). Приходит пропсом, потому
   * что список разделов знает только вызывающий — он же его и фильтрует по
   * флагам и правам. Каркас лишь ставит её в шапку слева от кнопок.
   */
  palette?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      {props.sidebar}
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="bg-white border-b border-gray-200 px-4 md:px-6 py-3 flex items-center justify-between"
          data-theme="light"
        >
          <div className="flex items-center min-w-0">
            {props.mobileNav}
            <div className="text-sm truncate text-gray-700">{props.headerLeft}</div>
          </div>
          <div className="flex items-center gap-2">
            {props.palette}
            {props.headerRight}
          </div>
        </header>
        <main className="flex-1 px-4 md:px-6 py-6">
          {/* Отступ снизу — чтобы нижняя панель не накрывала контент на телефоне. */}
          <div className="max-w-[1280px] mx-auto pb-16 md:pb-0">{props.children}</div>
        </main>
      </div>
    </div>
  );
}
