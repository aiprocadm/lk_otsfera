import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/components/students/add-student-dialog', () => ({
  AddStudentDialog: () => React.createElement('button', null, 'Добавить сотрудника'),
}));

const { listOrgCardEmployees } = vi.hoisted(() => ({ listOrgCardEmployees: vi.fn() }));
vi.mock('@/lib/services/organization/orgCardEmployees', () => ({ listOrgCardEmployees }));

import { EmployeesTab } from '@/components/partner/org-employees-tab';

const prisma = {} as unknown as PrismaClient;
const SESSION = { sub: 'p1', role: 'partner', partnerId: 'pt-1' } as never;

function employee(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    name: 'Анна Смирнова',
    email: 'anna@x.com',
    position: 'Инженер',
    status: 'active',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listOrgCardEmployees.mockResolvedValue({ rows: [], total: 0, canWrite: true });
});

/**
 * `У-97` (дефект `Д-27`): вкладка партнёра показывает СОТРУДНИКОВ организации —
 * тех же людей, которых заводит кнопка рядом. Раньше список читал пользователей
 * кабинета, и добавленный сотрудник в нём не появлялся никогда.
 */
describe('EmployeesTab партнёра (У-97)', () => {
  it('пустой список объясняет себя и предлагает добавить первого', async () => {
    const html = renderToString(
      await EmployeesTab({ orgId: 'org1', prisma, session: SESSION, searchParams: {} })
    );
    expect(html).toContain('Сотрудников пока нет');
    expect(html).toContain('Добавить сотрудника');
  });

  it('показывает сотрудника организации: ФИО, должность, почта', async () => {
    listOrgCardEmployees.mockResolvedValue({ rows: [employee()], total: 1, canWrite: true });
    const html = renderToString(
      await EmployeesTab({ orgId: 'org1', prisma, session: SESSION, searchParams: {} })
    );
    expect(html).toContain('Анна Смирнова');
    expect(html).toContain('anna@x.com');
    expect(html).toContain('Инженер');
  });

  it('строка ведёт на карточку сотрудника внутри портфеля партнёра', async () => {
    listOrgCardEmployees.mockResolvedValue({ rows: [employee()], total: 1, canWrite: true });
    const html = renderToString(
      await EmployeesTab({ orgId: 'org1', prisma, session: SESSION, searchParams: {} })
    );
    expect(html).toContain('/partner/portfolio/org1/students/s1');
  });

  it('данные берутся общим сервисом со скоупом роли, поиск и страница — из адреса', async () => {
    await EmployeesTab({
      orgId: 'org42',
      prisma,
      session: SESSION,
      searchParams: { q: 'смирн', skip: '25' },
    });
    expect(listOrgCardEmployees).toHaveBeenCalledWith(prisma, SESSION, {
      orgId: 'org42',
      q: 'смирн',
      skip: 25,
    });
  });

  it('без права на запись кнопки добавления нет (гард — в сервисе)', async () => {
    listOrgCardEmployees.mockResolvedValue({ rows: [employee()], total: 1, canWrite: false });
    const html = renderToString(
      await EmployeesTab({ orgId: 'org1', prisma, session: SESSION, searchParams: {} })
    );
    expect(html).not.toContain('Добавить сотрудника');
  });
});
