import { describe, expect, it, vi, beforeEach } from 'vitest';

const { studentOrgAccess } = vi.hoisted(() => ({ studentOrgAccess: vi.fn() }));
vi.mock('@/lib/services/students/access', () => ({ studentOrgAccess }));

const { getCompanyTeamVisibility } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import {
  listOrgCardEmployees,
  getOrgCardEmployee,
} from '@/lib/services/organization/orgCardEmployees';

const MANAGER = { sub: 'm1', role: 'manager', companyId: 'co-1', managedOrgIds: ['org-1'] } as never;
const PARTNER = { sub: 'p1', role: 'partner', partnerId: 'pt-1' } as never;

function db(rows: unknown[] = [], total = 0) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const count = vi.fn().mockResolvedValue(total);
  return { prisma: { student: { findMany, count } } as never, findMany, count };
}

beforeEach(() => {
  vi.clearAllMocks();
  studentOrgAccess.mockResolvedValue({ canRead: true, canWrite: true });
  getCompanyTeamVisibility.mockResolvedValue(false);
});

/**
 * `У-97`: вкладка «Сотрудники» карточки организации показывает СОТРУДНИКОВ
 * организации (`Student`) во всех кабинетах. До этапа 2 партнёрская вкладка
 * читала `OrganizationUser` — пользователей кабинета, — а кнопка рядом
 * заводила `Student`: добавленный человек в списке не появлялся никогда
 * (дефект `Д-27`).
 */
describe('listOrgCardEmployees (У-97)', () => {
  it('возвращает сотрудников организации со счётчиком и правом на запись', async () => {
    const { prisma, findMany, count } = db([{ id: 's1', name: 'Иванов' }], 3);
    const res = await listOrgCardEmployees(prisma, MANAGER, { orgId: 'org-1' });

    expect(res).toMatchObject({ rows: [{ id: 's1', name: 'Иванов' }], total: 3, canWrite: true });
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ organizationId: 'org-1' });
    expect(count.mock.calls[0]![0].where).toMatchObject({ organizationId: 'org-1' });
  });

  it('нет доступа к организации → пустая страница, в базу не ходим (гард в сервисе)', async () => {
    studentOrgAccess.mockResolvedValue({ canRead: false, canWrite: false });
    const { prisma, findMany, count } = db();
    const res = await listOrgCardEmployees(prisma, PARTNER, { orgId: 'foreign' });

    expect(res).toEqual({ rows: [], total: 0, canWrite: false });
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('право на запись отдаётся отдельно: читатель кнопки «Добавить» не получит', async () => {
    studentOrgAccess.mockResolvedValue({ canRead: true, canWrite: false });
    const { prisma } = db([], 0);
    const res = await listOrgCardEmployees(prisma, PARTNER, { orgId: 'org-1' });
    expect(res.canWrite).toBe(false);
  });

  it('менеджерский скоуп mode-aware: teamMode читается свежим и уходит в политику', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const { prisma } = db();
    await listOrgCardEmployees(prisma, MANAGER, { orgId: 'org-1' });
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(expect.anything(), 'co-1');
    expect(studentOrgAccess).toHaveBeenCalledWith(expect.anything(), MANAGER, 'org-1', true);
  });

  it('поиск по ФИО и почте — регистронезависимый', async () => {
    const { prisma, findMany } = db();
    await listOrgCardEmployees(prisma, MANAGER, { orgId: 'org-1', q: 'ивано' });
    expect(findMany.mock.calls[0]![0].where.OR).toEqual([
      { name: { contains: 'ивано', mode: 'insensitive' } },
      { email: { contains: 'ивано', mode: 'insensitive' } },
    ]);
  });

  it('фильтр «активные/все»: по умолчанию только активные', async () => {
    const { prisma, findMany } = db();
    await listOrgCardEmployees(prisma, MANAGER, { orgId: 'org-1' });
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ status: 'active' });

    const all = db();
    await listOrgCardEmployees(all.prisma, MANAGER, { orgId: 'org-1', includeInactive: true });
    expect(all.findMany.mock.calls[0]![0].where.status).toBeUndefined();
  });

  it('страницы по 25: молчаливого усечения списка нет', async () => {
    const { prisma, findMany } = db([], 300);
    await listOrgCardEmployees(prisma, MANAGER, { orgId: 'org-1', skip: 50 });
    expect(findMany.mock.calls[0]![0]).toMatchObject({ take: 25, skip: 50 });
  });
});


/**
 * `У-97`: карточка сотрудника открывается ВНУТРИ карточки организации.
 * Организация в адресе — граница, а не украшение.
 */
describe('getOrgCardEmployee (У-97)', () => {
  function detailDb(student: unknown) {
    const findFirst = vi.fn().mockResolvedValue(student);
    return { prisma: { student: { findFirst } } as never, findFirst };
  }

  const STUDENT = { id: 's1', name: 'Иванов', snils: '111', status: 'active' };

  it('ищет сотрудника ВМЕСТЕ с организацией — чужой id в своём адресе не сработает', async () => {
    const { prisma, findFirst } = detailDb(STUDENT);
    const res = await getOrgCardEmployee(prisma, MANAGER, { orgId: 'org-1', studentId: 's1' });

    expect(res).toMatchObject({ id: 's1' });
    expect(findFirst.mock.calls[0]![0].where).toEqual({ id: 's1', organizationId: 'org-1' });
  });

  it('нет доступа к организации → null, в базу не ходим (гард в сервисе)', async () => {
    studentOrgAccess.mockResolvedValue({ canRead: false, canWrite: false });
    const { prisma, findFirst } = detailDb(STUDENT);

    expect(await getOrgCardEmployee(prisma, PARTNER, { orgId: 'org-9', studentId: 's1' })).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('сотрудник другой организации → null и в журнал ПДн ничего не пишем', async () => {
    const { prisma } = detailDb(null);
    expect(await getOrgCardEmployee(prisma, MANAGER, { orgId: 'org-1', studentId: 'alien' })).toBeNull();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('выдача карточки журналируется — здесь видны СНИЛС и телефон (§25.7)', async () => {
    const { prisma } = detailDb(STUDENT);
    await getOrgCardEmployee(prisma, MANAGER, { orgId: 'org-1', studentId: 's1' });

    expect(recordPiiAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: 'org_card_employee_view', subjectIds: ['s1'] })
    );
  });

  it('режим видимости команды читается свежим и передаётся в политику (C8)', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const { prisma } = detailDb(STUDENT);
    await getOrgCardEmployee(prisma, MANAGER, { orgId: 'org-1', studentId: 's1' });

    expect(studentOrgAccess).toHaveBeenCalledWith(prisma, MANAGER, 'org-1', true);
  });
});
