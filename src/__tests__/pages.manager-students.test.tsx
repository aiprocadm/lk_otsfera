// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listStudents } = vi.hoisted(() => ({ listStudents: vi.fn() }));
vi.mock('@/lib/services/manager/students', () => ({ listStudents }));

vi.mock('@/components/manager/manager-students-table', () => ({
  ManagerStudentsTable: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'students-table' }, JSON.stringify(props.rows))
}));

import ManagerStudentsPage from '@/app/manager/students/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

describe('ManagerStudentsPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listStudents.mockReset();
  });

  it('lists students with the query filter and shows no "next" link when nextCursor is null', async () => {
    requireManager.mockResolvedValue(SESSION);
    listStudents.mockResolvedValue({ rows: [{ id: 's1', name: 'Студент' }], nextCursor: null });

    const { container } = await renderServerComponent(
      ManagerStudentsPage({ searchParams: Promise.resolve({ q: 'Иван' }) })
    );

    expect(listStudents).toHaveBeenCalledWith({}, expect.objectContaining({ session: SESSION, q: 'Иван', cursor: undefined }));
    expect(container.textContent).toContain('Сотрудники');
    expect(container.querySelector('input[name="q"]')?.getAttribute('value')).toBe('Иван');
    expect(container.textContent).not.toContain('Дальше');
  });

  it('renders the "next" link preserving q + cursor when nextCursor is present', async () => {
    requireManager.mockResolvedValue(SESSION);
    listStudents.mockResolvedValue({ rows: [], nextCursor: 'cur-2' });

    const { container } = await renderServerComponent(
      ManagerStudentsPage({ searchParams: Promise.resolve({ q: 'Иван', cursor: 'cur-1' }) })
    );

    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/manager/students?q=%D0%98%D0%B2%D0%B0%D0%BD&cursor=cur-2');
  });

  it('renders with no query and no cursor (defaults)', async () => {
    requireManager.mockResolvedValue(SESSION);
    listStudents.mockResolvedValue({ rows: [], nextCursor: null });

    const { container } = await renderServerComponent(
      ManagerStudentsPage({ searchParams: Promise.resolve({}) })
    );

    expect(listStudents).toHaveBeenCalledWith({}, expect.objectContaining({ q: undefined, cursor: undefined }));
    expect(container.querySelector('input[name="q"]')?.getAttribute('value')).toBe('');
  });
});
