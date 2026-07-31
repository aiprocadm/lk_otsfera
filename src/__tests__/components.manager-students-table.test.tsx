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

import { ManagerStudentsTable } from '@/components/manager/manager-students-table';
import type { ManagerStudentRow } from '@/lib/services/manager/students';

describe('ManagerStudentsTable', () => {
  it('empty: renders the empty-state message', () => {
    const html = renderToString(React.createElement(ManagerStudentsTable, { rows: [] }));
    expect(html).toContain('Сотрудники не найдены');
  });

  it('non-empty: renders row with student and org links, external id, and date', () => {
    const rows: ManagerStudentRow[] = [
      {
        id: 's1',
        name: 'Иванов Иван',
        email: 'ivanov@example.com',
        organization: { id: 'org1', name: 'ООО Ромашка' },
        externalStudentId: 'EXT-1',
        createdAt: new Date('2026-01-15'),
      } as ManagerStudentRow,
    ];
    const html = renderToString(React.createElement(ManagerStudentsTable, { rows }));
    expect(html).toContain('href="/manager/students/s1"');
    expect(html).toContain('Иванов Иван');
    expect(html).toContain('ivanov@example.com');
    expect(html).toContain('href="/manager/organizations/org1"');
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('EXT-1');
  });

  it('renders — for missing externalStudentId', () => {
    const rows: ManagerStudentRow[] = [
      {
        id: 's2',
        name: 'Петров Пётр',
        email: 'petrov@example.com',
        organization: { id: 'org2', name: 'ООО Ландыш' },
        externalStudentId: null,
        createdAt: new Date('2026-01-16'),
      } as ManagerStudentRow,
    ];
    const html = renderToString(React.createElement(ManagerStudentsTable, { rows }));
    expect(html).toContain('—');
  });
});
