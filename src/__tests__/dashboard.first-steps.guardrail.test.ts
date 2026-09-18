import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { readSource } from './helpers/source';

vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: () => true }));

import { getOrgFirstSteps, dismissOrgFirstSteps } from '@/lib/services/organization/firstSteps';
import { getPartnerFirstSteps, dismissPartnerFirstSteps } from '@/lib/services/partner/firstSteps';

/**
 * СТРАЖ `У-239` (решение `Р-Э6-5`): «Первые шаги» считаются по данным, а не
 * хранятся; «Закрыть» — отметка на членстве (организация / партнёр), не на
 * пользователе.
 *
 * Мутация (проверено): (1) `done: true` константой в ЛЮБОМ пункте (в том числе
 * «Заполнить реквизиты») → «по данным считается каждый пункт» краснеет; (2) `dismiss*` пишет `user.update` →
 * «на членстве, не на User» краснеет; (3) `onboardingDismissedAt` добавлен в
 * `model User` схемы → страж схемы краснеет.
 */

const SCHEMA = readSource(path.join(process.cwd(), 'prisma/schema.prisma'));

function modelBlock(name: string): string {
  const m = SCHEMA.match(new RegExp(`\\nmodel ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`model ${name} не найдена`);
  return m[0];
}

function orgDb(students: number, dismissedAt: Date | null) {
  return {
    organizationUser: {
      findUnique: vi.fn(async () => ({ onboardingDismissedAt: dismissedAt })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    organization: { findUnique: vi.fn(async () => ({ inn: null, legalAddress: null })) },
    student: { count: vi.fn(async () => students) },
    user: {
      findUnique: vi.fn(async () => ({ telegramChatId: null, maxChatId: null })),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    clientRequest: { count: vi.fn(async () => 0) },
    enrollmentRequest: { count: vi.fn(async () => 0) },
  };
}

/** Те же членства, но КАЖДЫЙ признак выполнен: все пункты обязаны стать `done`. */
function orgDbAllDone() {
  return {
    organizationUser: {
      findUnique: vi.fn(async () => ({ onboardingDismissedAt: null })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    organization: {
      findUnique: vi.fn(async () => ({ inn: '7701234567', legalAddress: 'Москва' })),
    },
    student: { count: vi.fn(async () => 3) },
    user: {
      findUnique: vi.fn(async () => ({ telegramChatId: '42', maxChatId: null })),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    clientRequest: { count: vi.fn(async () => 1) },
    enrollmentRequest: { count: vi.fn(async () => 1) },
  };
}

function partnerDbAllDone() {
  return {
    partnerUser: {
      findUnique: vi.fn(async () => ({ onboardingDismissedAt: null })),
      count: vi.fn(async () => 3),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    partner: { findUnique: vi.fn(async () => ({ inn: '7701234567', legalAddress: 'Москва' })) },
    organization: { count: vi.fn(async () => 2) },
    user: {
      findUnique: vi.fn(async () => ({ telegramChatId: '42', maxChatId: null })),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

function partnerDb(orgs: number) {
  return {
    partnerUser: {
      findUnique: vi.fn(async () => ({ onboardingDismissedAt: null })),
      count: vi.fn(async () => 1),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    partner: { findUnique: vi.fn(async () => ({ inn: null, legalAddress: null })) },
    organization: { count: vi.fn(async () => orgs) },
    user: {
      findUnique: vi.fn(async () => ({ telegramChatId: null, maxChatId: null })),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe('страж: «Первые шаги» по данным, «Закрыть» на членстве (У-239)', () => {
  it('пункт исчезает при выполнении по данным — одно и то же членство, разные данные', async () => {
    const before = await getOrgFirstSteps(orgDb(0, null) as unknown as PrismaClient, {
      organizationId: 'org1',
      userId: 'u1',
    });
    const after = await getOrgFirstSteps(orgDb(5, null) as unknown as PrismaClient, {
      organizationId: 'org1',
      userId: 'u1',
    });
    expect(before.items.find((i) => i.key === 'employees')?.done).toBe(false);
    expect(after.items.find((i) => i.key === 'employees')?.done).toBe(true);

    const pBefore = await getPartnerFirstSteps(partnerDb(0) as unknown as PrismaClient, {
      partnerId: 'p1',
      userId: 'u1',
      isPartnerAdmin: false,
    });
    const pAfter = await getPartnerFirstSteps(partnerDb(2) as unknown as PrismaClient, {
      partnerId: 'p1',
      userId: 'u1',
      isPartnerAdmin: false,
    });
    expect(pBefore.items.find((i) => i.key === 'firstOrganization')?.done).toBe(false);
    expect(pAfter.items.find((i) => i.key === 'firstOrganization')?.done).toBe(true);
  });

  it('по данным считается КАЖДЫЙ пункт, а не два известных', async () => {
    // Прежде страж проверял только «Добавить сотрудников» и «Первая
    // организация»: подмена любого другого пункта на `done: true` проходила
    // зелёной. Найдено сводной мутацией этапа (`У-241`). Теперь фиксируется
    // весь список: одно и то же членство, данные пустые против полных.
    const empty = await getOrgFirstSteps(orgDb(0, null) as unknown as PrismaClient, {
      organizationId: 'org1',
      userId: 'u1',
    });
    const full = await getOrgFirstSteps(orgDbAllDone() as unknown as PrismaClient, {
      organizationId: 'org1',
      userId: 'u1',
    });
    expect(empty.items.length, 'список пунктов пуст — страж охранял бы пустоту').toBeGreaterThan(2);
    expect(empty.items.length).toBe(full.items.length);
    for (const item of empty.items) {
      expect(item.done, `«${item.title}»: выполнен без данных — значит, не по данным`).toBe(false);
    }
    for (const item of full.items) {
      expect(item.done, `«${item.title}»: не выполнен при полных данных`).toBe(true);
    }

    const pEmpty = await getPartnerFirstSteps(partnerDb(0) as unknown as PrismaClient, {
      partnerId: 'p1',
      userId: 'u1',
      isPartnerAdmin: true,
    });
    const pFull = await getPartnerFirstSteps(partnerDbAllDone() as unknown as PrismaClient, {
      partnerId: 'p1',
      userId: 'u1',
      isPartnerAdmin: true,
    });
    expect(pEmpty.items.length, 'у партнёра пунктов нет').toBeGreaterThan(2);
    expect(pEmpty.items.length).toBe(pFull.items.length);
    for (const item of pEmpty.items) {
      expect(item.done, `партнёр, «${item.title}»: выполнен без данных`).toBe(false);
    }
    for (const item of pFull.items) {
      expect(item.done, `партнёр, «${item.title}»: не выполнен при полных данных`).toBe(true);
    }
  });

  it('«Закрыть» пишет на членство, а к пользователю не прикасается', async () => {
    const o = orgDb(0, null);
    await dismissOrgFirstSteps(o as unknown as PrismaClient, {
      organizationId: 'org1',
      userId: 'u1',
    });
    expect(o.organizationUser.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org1', userId: 'u1' }),
        data: { onboardingDismissedAt: expect.any(Date) },
      })
    );
    expect(o.user.update).not.toHaveBeenCalled();
    expect(o.user.updateMany).not.toHaveBeenCalled();

    const p = partnerDb(0);
    await dismissPartnerFirstSteps(p as unknown as PrismaClient, { partnerId: 'p1', userId: 'u1' });
    expect(p.partnerUser.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ partnerId: 'p1', userId: 'u1' }),
      })
    );
    expect(p.user.update).not.toHaveBeenCalled();
    expect(p.user.updateMany).not.toHaveBeenCalled();
  });

  it('закрытое членство прячет блок у этого членства', async () => {
    const v = await getOrgFirstSteps(orgDb(0, new Date()) as unknown as PrismaClient, {
      organizationId: 'org1',
      userId: 'u1',
    });
    expect(v.visible).toBe(false);
  });

  it('схема: отметка лежит на членствах, у пользователя её нет; выполненность не хранится', () => {
    expect(modelBlock('OrganizationUser')).toMatch(/onboardingDismissedAt\s+DateTime\?/);
    expect(modelBlock('PartnerUser')).toMatch(/onboardingDismissedAt\s+DateTime\?/);
    expect(modelBlock('User')).not.toContain('onboardingDismissedAt');
    // Ни одной колонки «шаг выполнен»: выполненность считается при показе.
    for (const model of ['OrganizationUser', 'PartnerUser', 'User', 'Organization', 'Partner']) {
      expect(modelBlock(model)).not.toMatch(/onboarding(Done|Completed|Steps)/);
      expect(modelBlock(model)).not.toMatch(/firstSteps/i);
    }
  });
});
