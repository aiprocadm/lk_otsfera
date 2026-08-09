'use client';

import React, { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/navigation/cabinet';
import { navIcon } from '@/lib/navigation/icons';
import { Dialog } from '@/components/ui/dialog';

/**
 * Мобильная навигация кабинета (`У-14`…`У-16`, этап 3 ТЗ понятности).
 *
 * Один компонент на три вещи, потому что у них **общее состояние**: кнопка-бургер
 * в шапке, нижняя панель с четырьмя вкладками и выдвижная панель с полным меню.
 * Пятая вкладка «Ещё» открывает ту же панель, что и бургер, — если бы состояние
 * жило в двух компонентах, их пришлось бы связывать через контекст.
 *
 * Нижняя панель `fixed bottom-0`, поэтому её положение на экране не зависит от
 * места в дереве — компонент целиком монтируется из шапки.
 *
 * Панель — примитив `Dialog` (CLAUDE.md §9): фокус-ловушка, Escape и возврат
 * фокуса приходят от нативного `<dialog>`, свой `role="dialog"` писать нельзя.
 * Внутрь кладётся **тот же** сайдбар (`variant='panel'`), а не вторая разметка.
 */
export function MobileNav(props: {
  /**
   * Меню целиком — рендерится внутри панели. Обычно `<Sidebar variant="panel" …/>`.
   *
   * Именно готовая разметка, а не функция: пропы-функции нельзя передать из
   * серверного компонента в клиентский. Закрытие панели по выбору пункта
   * ловится делегированием клика — см. обёртку ниже.
   */
  panel: ReactNode;
  /** Четыре вкладки нижней панели (`mobileTabsFor`). Пятая — «Ещё». */
  tabs: NavItem[];
  /**
   * Хвост запроса для ссылок вкладок — кабинет заказчика передаёт `org=<id>`,
   * когда организаций несколько. Строкой, а не функцией: пропы-функции через
   * границу сервер→клиент не проходят.
   */
  tabQuery?: string;
  /** Тёмная шапка партнёра и слушателя: бургер должен быть виден на чёрном. */
  theme?: 'light' | 'dark';
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? '';
  const close = () => setOpen(false);

  const columns = props.tabs.length + 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Открыть меню"
        aria-expanded={open}
        data-testid="mobile-burger"
        className={`md:hidden mr-2 h-9 w-9 rounded-lg text-xl leading-none ${
          props.theme === 'dark'
            ? 'text-white hover:bg-white/10'
            : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        ☰
      </button>

      <nav
        aria-label="Мобильная навигация"
        data-testid="mobile-bottom-bar"
        className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 md:hidden"
        style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {props.tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={props.tabQuery ? `${tab.href}?${props.tabQuery}` : tab.href}
              aria-current={active ? 'page' : undefined}
              data-testid={`mobile-tab-${tab.href.replace(/\//g, '-')}`}
              className={`flex flex-col items-center justify-center gap-0.5 h-14 text-xs font-medium ${
                active ? 'text-[#F97316]' : 'text-gray-600 active:bg-[#FFF7ED]'
              }`}
            >
              <span className="text-lg leading-none">{navIcon(tab.iconKey)}</span>
              {tab.label}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="mobile-tab-more"
          className="flex flex-col items-center justify-center gap-0.5 h-14 text-xs font-medium text-gray-600 active:bg-[#FFF7ED]"
        >
          <span className="text-lg leading-none">☰</span>
          Ещё
        </button>
      </nav>

      <Dialog open={open} onClose={close} title="Меню" size="sm">
        {/* Выбрал пункт — панель закрылась. Слушаем клик по ссылке
            делегированием: сайдбар общий и про панель ничего не знает. */}
        <div
          data-testid="mobile-menu-panel"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) close();
          }}
        >
          {props.panel}
        </div>
      </Dialog>
    </>
  );
}
