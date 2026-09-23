import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getPartnerFirstSteps, dismissPartnerFirstSteps } from '@/lib/services/partner/firstSteps';

/** «Первые шаги» партнёра (`У-239`): реквизиты, первая организация, бот, команда (admin). */

type Db = {
  membership: { onboardingDismissedAt: Date | null } | null;
  partner: { inn: string | null; legalAddress: string | null } | null;
  orgs: number;
  viewer: { telegramChatId: string | null; maxChatId: string | null } | null;
  team: number;
};

function db(over: Partial<Db> = {}) {
  const d: Db = {
    membership: { onboardingDismissedAt: null },
    partner: { inn: null, legalAddress: null },
    orgs: 0,
    viewer: { telegramChatId: null, maxChatId: null },
    team: 1,
    ...over,
  };
  const prisma = {
    partnerUser: {
      findUnique: vi.fn(async () => d.membership),
      count: vi.fn(async () => d.team),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    partner: { findUnique: vi.fn(async () => d.partner) },
    organization: { count: vi.fn(async () => d.orgs) },
    user: { findUnique: vi.fn(async () => d.viewer) },
  };
  return { prisma, casted: prisma as unknown as PrismaClient };
}

const ADMIN = { partnerId: 'p1', userId: 'u1', isPartnerAdmin: true };
const MANAGER = { partnerId: 'p1', userId: 'u2', isPartnerAdmin: false };

beforeEach(() => vi.clearAllMocks());

describe('getPartnerFirstSteps', () => {
  it('администратор: четыре пункта, «Команда» выполнена, когда в команде больше одного', async () => {
    const { prisma, casted } = db({ team: 1 });
    const v = await getPartnerFirstSteps(casted, ADMIN);
    expect(v.items.map((i) => [i.key, i.done, i.href])).toEqual([
      ['requisites', false, '/partner/settings?tab=profile'],
      ['firstOrganization', false, '/partner/portfolio'],
      ['bot', false, '/partner/settings?tab=profile'],
      // `У-263`: вкладка настроек, а не удалённый шлюз `/partner/team`.
      ['team', false, '/partner/settings?tab=team'],
    ]);
    expect(prisma.partnerUser.count).toHaveBeenCalledWith({
      where: { partnerId: 'p1', isActive: true },
    });
    const bigger = db({ team: 2 });
    expect(
      (await getPartnerFirstSteps(bigger.casted, ADMIN)).items.find((i) => i.key === 'team')?.done
    ).toBe(true);
  });

  it('рядовой менеджер партнёра: три пункта, команду не спрашиваем', async () => {
    const { prisma, casted } = db();
    const v = await getPartnerFirstSteps(casted, MANAGER);
    expect(v.items.map((i) => i.key)).toEqual(['requisites', 'firstOrganization', 'bot']);
    expect(prisma.partnerUser.count).not.toHaveBeenCalled();
  });

  it('выполненность по данным; всё сделано — блок не виден', async () => {
    const { casted } = db({
      partner: { inn: '7701234567', legalAddress: 'Москва' },
      orgs: 2,
      viewer: { telegramChatId: 't1', maxChatId: null },
      team: 3,
    });
    const v = await getPartnerFirstSteps(casted, ADMIN);
    expect(v).toMatchObject({ doneCount: 4, visible: false, dismissed: false });
  });

  it('«Закрыть» прячет блок; нет партнёра/членства — не падает', async () => {
    const closed = db({ membership: { onboardingDismissedAt: new Date() } });
    expect(await getPartnerFirstSteps(closed.casted, MANAGER)).toMatchObject({ visible: false });
    const none = db({ membership: null, partner: null, viewer: null });
    expect(await getPartnerFirstSteps(none.casted, MANAGER)).toMatchObject({
      visible: true,
      doneCount: 0,
    });
  });
});

describe('dismissPartnerFirstSteps', () => {
  it('отметка на активном членстве партнёра', async () => {
    const { prisma, casted } = db();
    expect(await dismissPartnerFirstSteps(casted, { partnerId: 'p1', userId: 'u1' })).toEqual({
      ok: true,
    });
    expect(prisma.partnerUser.updateMany).toHaveBeenCalledWith({
      where: { partnerId: 'p1', userId: 'u1', isActive: true },
      data: { onboardingDismissedAt: expect.any(Date) },
    });
    prisma.partnerUser.updateMany.mockResolvedValue({ count: 0 });
    expect(await dismissPartnerFirstSteps(casted, { partnerId: 'p1', userId: 'zz' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
