'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type NavItem = { href: string; label: string; icon: string; adminOnly?: boolean };

const ITEMS: NavItem[] = [
  { href: '/organization/dashboard', label: 'Главная', icon: '⌂' },
  { href: '/organization/orders', label: 'Заказы', icon: '📋' },
  { href: '/organization/documents', label: 'Документы', icon: '📄' },
  { href: '/organization/students', label: 'Сотрудники', icon: '👥' },
  { href: '/organization/team', label: 'Команда', icon: '⚙', adminOnly: true }
];

export type OrgSidebarMembership = {
  organizationId: string;
  organizationName: string;
  roleInOrg: 'admin' | 'member';
};

export function OrgSidebar(props: {
  memberships: OrgSidebarMembership[];
  activeOrgId: string;
  viewerRole: 'admin' | 'member';
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

  const items = ITEMS.filter((it) => !it.adminOnly || props.viewerRole === 'admin');

  return (
    <nav className='w-60 min-h-screen bg-white border-r border-gray-200 p-4 flex-shrink-0'>
      <div className='text-lg font-bold text-[#111111] mb-1 px-2'>Заказчик</div>
      <div className='text-xs text-gray-500 mb-4 px-2 truncate'>
        {activeOrg?.organizationName ?? 'Организация'}
      </div>

      {props.memberships.length > 1 ? (
        <div className='mb-6 px-2'>
          <label className='block text-xs font-medium uppercase tracking-wider text-gray-500 mb-1'>
            Организация
          </label>
          <select
            value={props.activeOrgId}
            onChange={onOrgChange}
            className='w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white'
            data-testid='org-selector'
          >
            {props.memberships.map((m) => (
              <option key={m.organizationId} value={m.organizationId}>
                {m.organizationName}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <ul className='space-y-0.5'>
        {items.map((item) => {
          const isActive =
            pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <li key={item.href}>
              <Link
                href={buildHref(item.href)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                  isActive
                    ? 'bg-[#F97316] text-white font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                data-testid={`org-nav-${item.href.replace(/\//g, '-')}`}
                data-active={isActive ? 'true' : 'false'}
              >
                <span className='text-base'>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
