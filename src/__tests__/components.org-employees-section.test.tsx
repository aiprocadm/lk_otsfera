// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/components/students/add-student-dialog', () => ({
  AddStudentDialog: ({ organizationId }: { organizationId: string }) =>
    React.createElement('button', { 'data-testid': `add-${organizationId}` }, 'Добавить сотрудника'),
}));

import { OrgEmployeesSection } from '@/components/organization/org-employees-section';
import type { OrgCardEmployeeRow } from '@/lib/services/organization/orgCardEmployees';

function row(over: Partial<OrgCardEmployeeRow> = {}): OrgCardEmployeeRow {
  return {
    id: 's1',
    name: 'Иванов Иван',
    email: 'ivanov@example.com',
    position: 'Электрик',
    status: 'active',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...over,
  };
}

const base = {
  orgId: 'org-1',
  basePath: '/manager/organizations/org-1',
  searchParams: {} as Record<string, string | string[] | undefined>,
  take: 25,
  skip: 0,
};

/**
 * `У-97`: вкладка показывает людей организации и даёт их завести. Раньше у
 * партнёра список и кнопка жили в разных мирах — добавленный сотрудник в
 * списке не появлялся.
 */
describe('OrgEmployeesSection (У-97)', () => {
  it('показывает сотрудников и кнопку «Добавить сотрудника» при праве на запись', () => {
    render(<OrgEmployeesSection {...base} rows={[row()]} total={1} canWrite />);
    expect(screen.getByText('Иванов Иван')).toBeTruthy();
    expect(screen.getByText('Электрик')).toBeTruthy();
    expect(screen.getByTestId('add-org-1')).toBeTruthy();
  });

  it('без права на запись кнопки нет — но список виден', () => {
    render(<OrgEmployeesSection {...base} rows={[row()]} total={1} canWrite={false} />);
    expect(screen.getByText('Иванов Иван')).toBeTruthy();
    expect(screen.queryByTestId('add-org-1')).toBeNull();
  });

  it('`У-74`: пустой список объясняет себя и предлагает действие', () => {
    render(<OrgEmployeesSection {...base} rows={[]} total={0} canWrite />);
    expect(screen.getByText(/Сотрудников пока нет/)).toBeTruthy();
    expect(screen.getByTestId('add-org-1')).toBeTruthy();
  });

  it('пустой результат поиска отличается от пустого списка', () => {
    render(
      <OrgEmployeesSection
        {...base}
        searchParams={{ q: 'петров' }}
        rows={[]}
        total={0}
        canWrite
      />
    );
    expect(screen.getByText(/Никого не нашли/)).toBeTruthy();
  });

  it('счётчик показывает, сколько людей всего — список не обрывается молча', () => {
    render(<OrgEmployeesSection {...base} rows={[row()]} total={120} canWrite />);
    expect(screen.getByTestId('employees-total').textContent).toContain('120');
  });

  it('строка ведёт на карточку сотрудника внутри организации', () => {
    render(<OrgEmployeesSection {...base} rows={[row()]} total={1} canWrite />);
    const link = within(screen.getByTestId('employee-row-s1')).getByRole('link');
    expect(link.getAttribute('href')).toBe('/manager/organizations/org-1/students/s1');
  });

  it('сотрудник без почты и должности показан прочерками, а не пустотой', () => {
    render(
      <OrgEmployeesSection
        {...base}
        rows={[row({ email: null, position: null })]}
        total={1}
        canWrite
      />
    );
    const cells = within(screen.getByTestId('employee-row-s1')).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toContain('—');
  });
});
