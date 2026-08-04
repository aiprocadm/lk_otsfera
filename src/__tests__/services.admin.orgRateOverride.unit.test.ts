/**
 * Unit-тесты для src/lib/services/admin/orgRateOverride.ts.
 *
 * Логика переехала сюда из server-action `setOrgRateOverrideAction`
 * (аудит A1: прямых запросов Prisma в экшенах нет). Проверяем ровно тот же
 * порядок решений: организация → партнёр → clear → ratePercent → validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setOrgCommissionRate, clearOrgCommissionRate, organizationFindUnique } = vi.hoisted(() => ({
  setOrgCommissionRate: vi.fn(),
  clearOrgCommissionRate: vi.fn(),
  organizationFindUnique: vi.fn(),
}));

vi.mock('@/lib/services/partner/rateOverride', () => ({
  setOrgCommissionRate,
  clearOrgCommissionRate,
}));

import { applyOrgRateOverride } from '@/lib/services/admin/orgRateOverride';

const prisma = { organization: { findUnique: organizationFindUnique } } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyOrgRateOverride', () => {
  it('читает partnerId организации узким select', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-42' });
    setOrgCommissionRate.mockResolvedValue({ ok: true });

    await applyOrgRateOverride(prisma, {
      organizationId: 'org-1',
      ratePercent: 8,
      reason: 'vip client',
      changedByUserId: 'admin-1',
    });

    expect(organizationFindUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: { partnerId: true },
    });
  });

  it('returns not_found when org lookup returns null', async () => {
    organizationFindUnique.mockResolvedValue(null);

    const res = await applyOrgRateOverride(prisma, {
      organizationId: 'missing-org',
      ratePercent: 8,
      reason: 'special deal',
      changedByUserId: 'admin-1',
    });

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(setOrgCommissionRate).not.toHaveBeenCalled();
    expect(clearOrgCommissionRate).not.toHaveBeenCalled();
  });

  it('returns not_found when org has no partnerId (standalone org)', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: null });

    const res = await applyOrgRateOverride(prisma, {
      organizationId: 'standalone-org',
      ratePercent: 8,
      reason: 'n/a',
      changedByUserId: 'admin-1',
    });

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(setOrgCommissionRate).not.toHaveBeenCalled();
  });

  it('set: зовёт setOrgCommissionRate с долей вместо процентов и partnerId из выборки', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-42' });
    setOrgCommissionRate.mockResolvedValue({ ok: true });

    const res = await applyOrgRateOverride(prisma, {
      organizationId: 'org-1',
      ratePercent: 8,
      reason: 'vip client',
      changedByUserId: 'admin-1',
    });

    expect(res).toEqual({ ok: true });
    expect(setOrgCommissionRate).toHaveBeenCalledWith(prisma, {
      organizationId: 'org-1',
      partnerId: 'partner-42',
      newRate: 0.08,
      reason: 'vip client',
      changedByUserId: 'admin-1',
    });
  });

  it('clear: зовёт clearOrgCommissionRate и не трогает set', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-42' });
    clearOrgCommissionRate.mockResolvedValue({ ok: true });

    const res = await applyOrgRateOverride(prisma, {
      organizationId: 'org-1',
      reason: 'reverting override',
      clear: true,
      changedByUserId: 'admin-1',
    });

    expect(res).toEqual({ ok: true });
    expect(clearOrgCommissionRate).toHaveBeenCalledWith(prisma, {
      organizationId: 'org-1',
      partnerId: 'partner-42',
      reason: 'reverting override',
      changedByUserId: 'admin-1',
    });
    expect(setOrgCommissionRate).not.toHaveBeenCalled();
  });

  it('clear имеет приоритет над ratePercent (порядок проверок сохранён)', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-42' });
    clearOrgCommissionRate.mockResolvedValue({ ok: true });

    await applyOrgRateOverride(prisma, {
      organizationId: 'org-1',
      ratePercent: 8,
      reason: 'both given',
      clear: true,
      changedByUserId: 'admin-1',
    });

    expect(clearOrgCommissionRate).toHaveBeenCalled();
    expect(setOrgCommissionRate).not.toHaveBeenCalled();
  });

  it('returns validation when neither clear nor ratePercent is given', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-42' });

    const res = await applyOrgRateOverride(prisma, {
      organizationId: 'org-1',
      reason: 'test',
      changedByUserId: 'admin-1',
    });

    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(setOrgCommissionRate).not.toHaveBeenCalled();
    expect(clearOrgCommissionRate).not.toHaveBeenCalled();
  });

  it('пробрасывает rate_out_of_range из setOrgCommissionRate', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-42' });
    setOrgCommissionRate.mockResolvedValue({ ok: false, error: 'rate_out_of_range' });

    const res = await applyOrgRateOverride(prisma, {
      organizationId: 'org-1',
      ratePercent: 800,
      reason: 'bad rate',
      changedByUserId: 'admin-1',
    });

    expect(res).toEqual({ ok: false, error: 'rate_out_of_range' });
  });

  it('пробрасывает not_found из clearOrgCommissionRate (гонка по partnerId)', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-42' });
    clearOrgCommissionRate.mockResolvedValue({ ok: false, error: 'not_found' });

    const res = await applyOrgRateOverride(prisma, {
      organizationId: 'org-1',
      reason: 'race',
      clear: true,
      changedByUserId: 'admin-1',
    });

    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});
