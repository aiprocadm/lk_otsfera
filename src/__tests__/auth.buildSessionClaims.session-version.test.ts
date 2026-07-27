/**
 * Этап 9 (ФТ-11.2): клейм sessionVersion в клеймах сессии.
 *
 * buildSessionClaims — единственная точка сборки токена (её же зовёт 2FA-verify),
 * поэтому версия обязана попадать в клеймы для ЛЮБОЙ роли. Если она потеряется,
 * getSession прочитает токен как версию 0 и ревокация работать не будет.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient, User } from '@prisma/client';
import { buildSessionClaims } from '@/lib/auth/buildSessionClaims';

type FakePrisma = {
  partnerUser: { findUnique: ReturnType<typeof vi.fn> };
  organizationUser: { findMany: ReturnType<typeof vi.fn> };
  organizationManager: { findMany: ReturnType<typeof vi.fn> };
  accessProfile: { findUnique: ReturnType<typeof vi.fn> };
};

function makePrisma(overrides: Partial<FakePrisma> = {}): PrismaClient {
  const base: FakePrisma = {
    partnerUser: { findUnique: vi.fn().mockResolvedValue(null) },
    organizationUser: { findMany: vi.fn().mockResolvedValue([]) },
    organizationManager: { findMany: vi.fn().mockResolvedValue([]) },
    accessProfile: { findUnique: vi.fn().mockResolvedValue(null) }
  };
  return { ...base, ...overrides } as unknown as PrismaClient;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-1',
    email: 'u@example.ru',
    name: 'Пользователь',
    role: 'admin',
    isActive: true,
    companyId: null,
    partnerId: null,
    organizationId: null,
    externalStudentId: null,
    managerRole: null,
    accessProfileId: null,
    sessionVersion: 0,
    ...overrides
  } as unknown as User;
}

describe('buildSessionClaims — клейм sessionVersion', () => {
  it('кладёт в клеймы текущую версию сессии пользователя', async () => {
    const result = await buildSessionClaims(makePrisma(), makeUser({ sessionVersion: 7 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.sessionVersion).toBe(7);
  });

  it('кладёт нулевую версию явно (не undefined) — токен «свежего» пользователя', async () => {
    const result = await buildSessionClaims(makePrisma(), makeUser({ sessionVersion: 0 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.sessionVersion).toBe(0);
    expect('sessionVersion' in result.claims).toBe(true);
  });

  it('проставляет версию менеджеру (роль с денормализацией managedOrgIds)', async () => {
    const prisma = makePrisma({
      organizationManager: { findMany: vi.fn().mockResolvedValue([{ organizationId: 'org-1' }]) }
    });

    const result = await buildSessionClaims(
      prisma,
      makeUser({ id: 'mgr-1', role: 'manager', companyId: 'co-1', sessionVersion: 2 })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.sessionVersion).toBe(2);
    expect(result.claims.managedOrgIds).toEqual(['org-1']);
  });

  it('проставляет версию партнёру с активным членством', async () => {
    const prisma = makePrisma({
      partnerUser: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ isActive: true, roleInPartner: 'admin', assignedOrgIds: ['org-9'] })
      }
    });

    const result = await buildSessionClaims(
      prisma,
      makeUser({ id: 'p-1', role: 'partner', partnerId: 'partner-1', sessionVersion: 5 })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.sessionVersion).toBe(5);
    expect(result.claims.partnerRole).toBe('admin');
  });

  it('проставляет версию пользователю организации', async () => {
    const prisma = makePrisma({
      organizationUser: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ organizationId: 'org-2', roleInOrg: 'member', isActive: true }])
      }
    });

    const result = await buildSessionClaims(
      prisma,
      makeUser({ id: 'o-1', role: 'organization', organizationId: 'org-2', sessionVersion: 1 })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.sessionVersion).toBe(1);
  });

  it('деактивированное партнёрское членство отдаёт ошибку и клеймов не собирает', async () => {
    const prisma = makePrisma({
      partnerUser: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ isActive: false, roleInPartner: 'manager', assignedOrgIds: [] })
      }
    });

    const result = await buildSessionClaims(
      prisma,
      makeUser({ id: 'p-2', role: 'partner', partnerId: 'partner-2', sessionVersion: 3 })
    );

    expect(result).toEqual({ ok: false, error: 'account_deactivated' });
  });
});
