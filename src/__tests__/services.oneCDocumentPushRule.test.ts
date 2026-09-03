/**
 * Этап 8 (PR-4) — правило выгрузки документов в 1С (`У-169`): граница
 * «admin — любая компания, leader — только своя, менеджеру отказ» (`Р-22`),
 * набор типов ⊆ четырёх выгружаемых (КП — `invalid_types`, а не ошибка базы),
 * канонический порядок набора, аудит с «было/стало».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { updateOneCDocumentPushRule } from '@/lib/services/admin/oneCDocumentPushRule';

const adminSession = (): SessionPayload =>
  ({ sub: 'a1', role: 'admin', companyId: null }) as unknown as SessionPayload;
const leaderSession = (companyId = 'co-1'): SessionPayload =>
  ({ sub: 'l1', role: 'leader', companyId }) as unknown as SessionPayload;
const managerSession = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-1' }) as unknown as SessionPayload;

const CURRENT = { oneCDocumentPushMode: 'manual', oneCDocumentPushTypes: ['invoice', 'act'] };

function fake(company: Record<string, unknown> | null = CURRENT) {
  const update = vi.fn().mockResolvedValue({});
  const findUnique = vi.fn().mockResolvedValue(company);
  const prisma = { company: { findUnique, update } } as unknown as PrismaClient;
  return { prisma, update, findUnique };
}

const ALL = ['invoice', 'act', 'contract', 'extra_agreement'];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateOneCDocumentPushRule — граница компании (Р-22)', () => {
  it('менеджер → forbidden, базу не трогаем', async () => {
    const { prisma, update, findUnique } = fake();
    expect(
      await updateOneCDocumentPushRule(prisma, managerSession(), 'co-1', { mode: 'auto', types: ALL })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('руководитель чужой компании → forbidden; своей — сохраняет', async () => {
    const { prisma, update } = fake();
    expect(
      await updateOneCDocumentPushRule(prisma, leaderSession('co-2'), 'co-1', {
        mode: 'auto',
        types: ALL,
      })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(update).not.toHaveBeenCalled();

    expect(
      await updateOneCDocumentPushRule(prisma, leaderSession('co-1'), 'co-1', {
        mode: 'auto',
        types: ALL,
      })
    ).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { oneCDocumentPushMode: 'auto', oneCDocumentPushTypes: ALL },
    });
  });

  it('админ правит любую компанию; несуществующая → not_found', async () => {
    const ok = fake();
    expect(
      await updateOneCDocumentPushRule(ok.prisma, adminSession(), 'co-9', {
        mode: 'never',
        types: [],
      })
    ).toEqual({ ok: true });
    expect(ok.update).toHaveBeenCalledWith({
      where: { id: 'co-9' },
      data: { oneCDocumentPushMode: 'never', oneCDocumentPushTypes: [] },
    });

    const gone = fake(null);
    expect(
      await updateOneCDocumentPushRule(gone.prisma, adminSession(), 'co-9', {
        mode: 'never',
        types: [],
      })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(gone.update).not.toHaveBeenCalled();
  });
});

describe('updateOneCDocumentPushRule — проверка входа', () => {
  it('КП в наборе → invalid_types: код, а не ошибка базы (CHECK)', async () => {
    const { prisma, update } = fake();
    expect(
      await updateOneCDocumentPushRule(prisma, adminSession(), 'co-1', {
        mode: 'auto',
        types: ['invoice', 'commercial_proposal'],
      })
    ).toEqual({ ok: false, error: 'invalid_types' });
    expect(update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('незнакомый режим → invalid_mode', async () => {
    const { prisma, update } = fake();
    expect(
      await updateOneCDocumentPushRule(prisma, adminSession(), 'co-1', {
        mode: 'sometimes',
        types: ALL,
      })
    ).toEqual({ ok: false, error: 'invalid_mode' });
    expect(update).not.toHaveBeenCalled();
  });

  it('набор хранится в каноническом порядке без повторов', async () => {
    const { prisma, update } = fake();
    await updateOneCDocumentPushRule(prisma, adminSession(), 'co-1', {
      mode: 'manual',
      types: ['extra_agreement', 'invoice', 'invoice'],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { oneCDocumentPushMode: 'manual', oneCDocumentPushTypes: ['invoice', 'extra_agreement'] },
    });
  });

  it('аудит: company_onec_push_rule_changed с «было/стало»', async () => {
    const { prisma } = fake();
    await updateOneCDocumentPushRule(prisma, leaderSession(), 'co-1', {
      mode: 'auto',
      types: ['contract'],
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'l1',
      action: 'company_onec_push_rule_changed',
      entity: 'company',
      entityId: 'co-1',
      before: { mode: 'manual', types: ['invoice', 'act'] },
      after: { mode: 'auto', types: ['contract'] },
    });
  });
});
