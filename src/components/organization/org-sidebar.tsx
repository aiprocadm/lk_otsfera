'use client';

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { NavItem } from '@/lib/navigation/cabinet';
import { Sidebar } from '@/components/shell/sidebar';

// Тип переехал в lib/auth/orgPageContext (правило lib-no-upward, фаза 3);
// реэкспорт сохраняет публичный API компонента (org-app-shell импортирует отсюда).
export type { OrgSidebarMembership } from '@/lib/auth/orgPageContext';
import type { OrgSidebarMembership } from '@/lib/auth/orgPageContext';

/**
 * Сайдбар кабинета заказчика (`У-11`, этап 2).
 *
 * Своей разметки меню больше нет — она общая (`components/shell/sidebar`).
 * Здесь остаётся только то, чего нет у других кабинетов: переключатель
 * организаций (клиентский, cookie + `?org=`) и дописывание `?org=` к ссылкам,
 * когда организаций у пользователя несколько.
 */
export function OrgSidebar(props: {
  items: NavItem[];
  memberships: OrgSidebarMembership[];
  activeOrgId: string;
  viewerRole: 'admin' | 'leader' | 'member';
  /** `panel` — то же меню внутри выдвижной панели бургера (этап 3, `У-14`). */
  variant?: 'desktop' | 'panel';
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeOrg = props.memberships.find((m) => m.organizationId === props.activeOrgId);

  function buildHref(base: string): string {
    if (props.memberships.length <= 1) return base;
    const sp = new URLSearchParams(searchParams?.toString() ?? '');
    sp.set('org', props.activeOrgId);
    return `${base}?${sp.toString()}`;
  }

  function onOrgChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextOrg = e.target.value;
    // persist as cookie for future requests
    document.cookie = `org_ctx=${encodeURIComponent(nextOrg)}; Path=/; SameSite=Lax`;
    const sp = new URLSearchParams(searchParams?.toString() ?? '');
    sp.set('org', nextOrg);
    router.push(`${pathname}?${sp.toString()}`);
  }

  // `У-100`: признака `orgAdminOrLeaderOnly` больше нет. Его носил один пункт
  // — «Доступ в кабинет», — а он уехал во вкладку «Настройки» раздела «Моя
  // организация». Фильтр без единого пункта — мёртвый код (§12b), поэтому
  // снят вместе с ним; право по-прежнему проверяет сервер.
  const items = props.items;

  const selector =
    props.memberships.length > 1 ? (
      <div className="mb-6 px-2">
        <label className="block text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">
          Организация
        </label>
        <select
          value={props.activeOrgId}
          onChange={onOrgChange}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
          data-testid="org-selector"
        >
          {props.memberships.map((m) => (
            <option key={m.organizationId} value={m.organizationId}>
              {m.organizationName}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  return (
    <Sidebar
      items={items}
      title="Заказчик"
      subtitle={activeOrg?.organizationName ?? 'Организация'}
      testIdPrefix="org"
      top={selector}
      linkHref={buildHref}
      {...(props.variant ? { variant: props.variant } : {})}
    />
  );
}
