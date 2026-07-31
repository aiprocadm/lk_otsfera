import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));

import { ManagerOrgsList } from '@/components/manager/manager-orgs-list';
import type { ManagerOrgListRow } from '@/lib/services/manager/organizations';

describe('ManagerOrgsList', () => {
  it('empty: renders the empty-state message', () => {
    const html = renderToString(React.createElement(ManagerOrgsList, { orgs: [] }));
    expect(html).toContain('Вам пока не назначено ни одной организации');
  });

  it('non-empty: renders a row linking to /manager/organizations/{id}', () => {
    const orgs: ManagerOrgListRow[] = [
      { id: 'org1', name: 'ООО Ромашка', _count: { orders: 4, students: 9 } } as ManagerOrgListRow,
    ];
    const html = renderToString(React.createElement(ManagerOrgsList, { orgs }));
    expect(html).toContain('href="/manager/organizations/org1"');
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('4');
    expect(html).toContain('9');
  });
});
