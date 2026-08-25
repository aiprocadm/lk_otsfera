'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CABINET_SWITCH,
  switchCabinetHref,
  type SwitchableCabinet,
} from '@/lib/navigation/cabinetSwitch';

/**
 * Переключатель кабинетов руководителя в шапке (`У-111`).
 *
 * Показывается только роли `leader` — у остальных кабинет один, и выбирать
 * нечего. Это две ссылки, а не выпадающий список: вариантов всего два, и
 * лишний клик здесь ничего не даёт.
 *
 * Раздел сохраняется, если он есть в обоих кабинетах, — решает
 * `switchCabinetHref`, чтобы правило было одно и проверялось тестом.
 */
export function CabinetSwitcher({ current }: { current: SwitchableCabinet }) {
  const pathname = usePathname() ?? '';

  return (
    <span className="inline-flex items-center gap-1" data-testid="cabinet-switcher">
      <span className="text-gray-500">Кабинет:</span>
      {CABINET_SWITCH.map(({ cabinet, label }) =>
        cabinet === current ? (
          <span
            key={cabinet}
            aria-current="true"
            data-testid={`cabinet-switch-${cabinet}`}
            className="rounded bg-[#F97316] px-2 py-0.5 text-sm font-medium text-white"
          >
            {label}
          </span>
        ) : (
          <Link
            key={cabinet}
            href={switchCabinetHref(pathname, cabinet)}
            data-testid={`cabinet-switch-${cabinet}`}
            className="rounded px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-[#111111]"
          >
            {label}
          </Link>
        )
      )}
    </span>
  );
}
