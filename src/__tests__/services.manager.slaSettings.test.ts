/**
 * Этап 7 (§4.4, PR-3) — пороги SLA компании: чтение, валидация, идемпотентность,
 * аудит; server-action (гейт лидера, no_company). Prisma-фейки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { recordAuditMock, requireManagerLeader, revalidatePath } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  requireManagerLeader: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));
vi.mock('next/cache', () => ({ revalidatePath }));

const { setSlaSettingsService } = vi.hoisted(() => ({ setSlaSettingsService: vi.fn() }));

import type { SessionPayload } from '@/lib/auth/jwt';
import {
  getSlaSettings,
  listCompaniesSla,
  setSlaSettings,
} from '@/lib/services/manager/slaSettings';

function fakePrisma(row: { slaResponseHours: number; slaWarningHours: number } | null) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const update = vi.fn().mockResolvedValue({});
  return {
    prisma: { company: { findUnique, update } } as unknown as PrismaClient,
    findUnique,
    update,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('getSlaSettings / setSlaSettings', () => {
  it('чтение возвращает пороги; отсутствующая компания → null', async () => {
    expect(
      await getSlaSettings(fakePrisma({ slaResponseHours: 24, slaWarningHours: 4 }).prisma, 'c1')
    ).toEqual({
      slaResponseHours: 24,
      slaWarningHours: 4,
    });
    expect(await getSlaSettings(fakePrisma(null).prisma, 'c1')).toBeNull();
  });

  it('валидация: границы 1–168, целые, warning < response', async () => {
    const { prisma, update } = fakePrisma({ slaResponseHours: 24, slaWarningHours: 4 });
    for (const bad of [
      { slaResponseHours: 0, slaWarningHours: 4 },
      { slaResponseHours: 200, slaWarningHours: 4 },
      { slaResponseHours: 24, slaWarningHours: 0 },
      { slaResponseHours: 24.5, slaWarningHours: 4 },
      { slaResponseHours: 4, slaWarningHours: 4 },
      { slaResponseHours: 4, slaWarningHours: 10 },
    ]) {
      const r = await setSlaSettings(prisma, 'u1', 'c1', bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('validation');
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('успех: пишет пороги + аудит с before/after', async () => {
    const { prisma, update } = fakePrisma({ slaResponseHours: 24, slaWarningHours: 4 });
    const r = await setSlaSettings(prisma, 'u1', 'c1', {
      slaResponseHours: 48,
      slaWarningHours: 8,
    });
    expect(r).toEqual({ ok: true, changed: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { slaResponseHours: 48, slaWarningHours: 8 },
    });
    expect(recordAuditMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'sla_settings_changed', entity: 'company', entityId: 'c1' })
    );
  });

  it('идемпотентность (без записи и аудита) и company_not_found', async () => {
    const same = fakePrisma({ slaResponseHours: 24, slaWarningHours: 4 });
    expect(
      await setSlaSettings(same.prisma, 'u1', 'c1', { slaResponseHours: 24, slaWarningHours: 4 })
    ).toEqual({
      ok: true,
      changed: false,
    });
    expect(same.update).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();

    expect(
      await setSlaSettings(fakePrisma(null).prisma, 'u1', 'cX', {
        slaResponseHours: 24,
        slaWarningHours: 4,
      })
    ).toEqual({
      ok: false,
      error: 'company_not_found',
    });
  });
});

/**
 * `У-130` + `components-no-db` (хотфикс): выборка экрана «SLA входящих в
 * работу» переехала из компонента в сервис — скоуп проверяем здесь.
 */
describe('listCompaniesSla', () => {
  const session = (role: string, companyId: string | null = null): SessionPayload =>
    ({ sub: 'u1', role, companyId }) as unknown as SessionPayload;
  const rows = [{ id: 'c1', name: 'А', slaResponseHours: 24, slaWarningHours: 4 }];

  function listPrisma(result: unknown[] | Error) {
    const findMany =
      result instanceof Error
        ? vi.fn().mockRejectedValue(result)
        : vi.fn().mockResolvedValue(result);
    return { prisma: { company: { findMany } } as unknown as PrismaClient, findMany };
  }

  it('админ: все компании по алфавиту', async () => {
    const { prisma, findMany } = listPrisma(rows);
    expect(await listCompaniesSla(prisma, session('admin'))).toEqual({ ok: true, companies: rows });
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, slaResponseHours: true, slaWarningHours: true },
      orderBy: { name: 'asc' },
    });
  });

  it('руководитель: только СВОЯ компания, без компании — в базу не ходим', async () => {
    const { prisma, findMany } = listPrisma(rows);
    expect(await listCompaniesSla(prisma, session('leader', 'c1'))).toEqual({
      ok: true,
      companies: rows,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { id: 'c1' },
      select: { id: true, name: true, slaResponseHours: true, slaWarningHours: true },
    });

    const empty = listPrisma(rows);
    expect(await listCompaniesSla(empty.prisma, session('leader'))).toEqual({
      ok: true,
      companies: [],
    });
    expect(empty.findMany).not.toHaveBeenCalled();
  });

  it('чужая роль — forbidden без похода в базу', async () => {
    const { prisma, findMany } = listPrisma(rows);
    expect(await listCompaniesSla(prisma, session('partner'))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('ошибка базы проглатывается в пустой список (экран покажет пустое состояние)', async () => {
    // Оба пути — админский и руководительский — деградируют одинаково.
    expect(
      await listCompaniesSla(listPrisma(new Error('db down')).prisma, session('admin'))
    ).toEqual({ ok: true, companies: [] });
    expect(
      await listCompaniesSla(listPrisma(new Error('db down')).prisma, session('leader', 'c1'))
    ).toEqual({ ok: true, companies: [] });
  });
});

describe('setSlaSettingsAction', () => {
  it('гейт лидера, no_company, успех с ревалидацией', async () => {
    vi.doMock('@/lib/services/manager/slaSettings', () => ({
      setSlaSettings: setSlaSettingsService,
    }));
    vi.doMock('@/lib/db/prisma', () => ({ prisma: {} }));
    const { setSlaSettingsAction } = await import('@/server-actions/manager/slaSettings');

    requireManagerLeader.mockResolvedValue({
      sub: 'u1',
      role: 'leader',
      companyId: null,
    });
    expect(await setSlaSettingsAction({ slaResponseHours: 24, slaWarningHours: 4 })).toEqual({
      ok: false,
      error: 'no_company',
    });

    requireManagerLeader.mockResolvedValue({
      sub: 'u1',
      role: 'leader',
      companyId: 'c1',
    });
    setSlaSettingsService.mockResolvedValue({ ok: true, changed: true });
    expect(await setSlaSettingsAction({ slaResponseHours: 48, slaWarningHours: 8 })).toEqual({
      ok: true,
      changed: true,
    });
    expect(setSlaSettingsService).toHaveBeenCalledWith({}, 'u1', 'c1', {
      slaResponseHours: 48,
      slaWarningHours: 8,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/leader/team');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/intake');

    setSlaSettingsService.mockResolvedValue({ ok: false, error: 'validation', messages: ['x'] });
    expect(await setSlaSettingsAction({ slaResponseHours: 2, slaWarningHours: 5 })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['x'],
    });

    // Мусорный вход отбивается zod'ом до сервиса.
    expect(
      await setSlaSettingsAction({ slaResponseHours: Number.NaN, slaWarningHours: 4 })
    ).toEqual({
      ok: false,
      error: 'validation',
    });
  });
});
