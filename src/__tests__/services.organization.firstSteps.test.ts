import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

import { getOrgFirstSteps, dismissOrgFirstSteps } from '@/lib/services/organization/firstSteps';

/** «Первые шаги» заказчика (`У-239`, `Р-Э6-5`): выполненность по данным, «Закрыть» на членстве. */

type Db = {
  membership: { onboardingDismissedAt: Date | null } | null;
  org: { inn: string | null; legalAddress: string | null } | null;
  students: number;
  viewer: { telegramChatId: string | null; maxChatId: string | null } | null;
  requests: number;
  enrollments: number;
};

function db(over: Partial<Db> = {}) {
  const d: Db = {
    membership: { onboardingDismissedAt: null },
    org: { inn: null, legalAddress: null },
    students: 0,
    viewer: { telegramChatId: null, maxChatId: null },
    requests: 0,
    enrollments: 0,
    ...over,
  };
  const prisma = {
    organizationUser: {
      findUnique: vi.fn(async () => d.membership),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    organization: { findUnique: vi.fn(async () => d.org) },
    student: { count: vi.fn(async () => d.students) },
    user: { findUnique: vi.fn(async () => d.viewer) },
    clientRequest: { count: vi.fn(async () => d.requests) },
    enrollmentRequest: { count: vi.fn(async () => d.enrollments) },
  };
  return { prisma, casted: prisma as unknown as PrismaClient };
}

const ARGS = { organizationId: 'org1', userId: 'u1' };

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
});

describe('getOrgFirstSteps', () => {
  it('новая организация: четыре пункта, ни один не выполнен, блок виден', async () => {
    const { prisma, casted } = db();
    const v = await getOrgFirstSteps(casted, ARGS);
    expect(v.items.map((i) => [i.key, i.done])).toEqual([
      ['requisites', false],
      ['employees', false],
      ['bot', false],
      ['firstRequest', false],
    ]);
    expect(v).toMatchObject({ doneCount: 0, dismissed: false, visible: true });
    expect(prisma.organizationUser.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: 'org1', userId: 'u1' } },
      select: { onboardingDismissedAt: true },
    });
    expect(prisma.student.count).toHaveBeenCalledWith({ where: { organizationId: 'org1' } });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { telegramChatId: true, maxChatId: true },
    });
  });

  it('выполненность считается по данным: реквизиты, сотрудники, бот (MAX тоже), обращение', async () => {
    const { casted } = db({
      org: { inn: '7701234567', legalAddress: 'Москва' },
      students: 3,
      viewer: { telegramChatId: null, maxChatId: 'm1' },
      enrollments: 1,
    });
    const v = await getOrgFirstSteps(casted, ARGS);
    expect(v.items.every((i) => i.done)).toBe(true);
    expect(v).toMatchObject({ doneCount: 4, visible: false });
  });

  it('реквизиты «заполнены» только при ИНН И адресе вместе', async () => {
    const { casted } = db({ org: { inn: '7701234567', legalAddress: null } });
    const v = await getOrgFirstSteps(casted, ARGS);
    expect(v.items.find((i) => i.key === 'requisites')?.done).toBe(false);
  });

  it('ссылки ведут на экраны шагов; первое обращение — по флагам, чтобы не вести в 404', async () => {
    const { casted } = db();
    const v = await getOrgFirstSteps(casted, ARGS);
    const href = Object.fromEntries(v.items.map((i) => [i.key, i.href]));
    expect(href).toEqual({
      requisites: '/organization/company?tab=settings',
      employees: '/organization/company?tab=employees',
      bot: '/organization/settings?tab=profile',
      firstRequest: '/organization/requests',
    });
    isFeatureEnabled.mockImplementation((f: string) => f === 'enrollment_requests');
    expect(
      (await getOrgFirstSteps(casted, ARGS)).items.find((i) => i.key === 'firstRequest')?.href
    ).toBe('/organization/enrollments');
    isFeatureEnabled.mockReturnValue(false);
    expect(
      (await getOrgFirstSteps(casted, ARGS)).items.find((i) => i.key === 'firstRequest')?.href
    ).toBe('/organization/orders');
  });

  it('«Закрыть» на членстве прячет блок; членства или организации нет — блок виден без падения', async () => {
    const closed = db({ membership: { onboardingDismissedAt: new Date('2026-09-17') } });
    expect(await getOrgFirstSteps(closed.casted, ARGS)).toMatchObject({
      dismissed: true,
      visible: false,
    });
    const none = db({ membership: null, org: null, viewer: null });
    expect(await getOrgFirstSteps(none.casted, ARGS)).toMatchObject({
      dismissed: false,
      visible: true,
      doneCount: 0,
    });
  });
});

describe('dismissOrgFirstSteps', () => {
  it('пишет отметку на активное членство организации, а не на пользователя', async () => {
    const { prisma, casted } = db();
    expect(await dismissOrgFirstSteps(casted, ARGS)).toEqual({ ok: true });
    expect(prisma.organizationUser.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1', userId: 'u1', isActive: true },
      data: { onboardingDismissedAt: expect.any(Date) },
    });
  });

  it('членства нет — not_found', async () => {
    const { prisma, casted } = db();
    prisma.organizationUser.updateMany.mockResolvedValue({ count: 0 });
    expect(await dismissOrgFirstSteps(casted, ARGS)).toEqual({ ok: false, error: 'not_found' });
  });
});
