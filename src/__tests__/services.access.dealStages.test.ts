/**
 * Unit-тесты src/lib/services/access/dealStages.ts (этап 6, ФТ-4.2) на prisma-моке.
 *
 *   - роль-гейт: admin / manager-leader ок; рядовой менеджер, partner,
 *     без companyId → forbidden;
 *   - валидация zod: пустое имя, кривой цвет, неизвестный якорь;
 *   - терминальность выводится из якоря: won/lost → isTerminal=true всегда;
 *   - list/create/update/delete happy + аудит; чужая компания → not_found;
 *   - position_taken на P2002 (@@unique([companyId, position])).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  listDealStages,
  createDealStage,
  updateDealStage,
  deleteDealStage,
  type DealStageInput
} from '@/lib/services/access/dealStages';

// ─── helpers ──────────────────────────────────────────────────────────────────

const ADMIN: SessionPayload = { sub: 'adm-1', role: 'admin', companyId: 'c1' };
const LEADER: SessionPayload = { sub: 'ld-1', role: 'manager', managerRole: 'leader', companyId: 'c1' };
const PLAIN_MGR: SessionPayload = { sub: 'm-1', role: 'manager', companyId: 'c1' };
const PARTNER: SessionPayload = { sub: 'p-1', role: 'partner', partnerId: 'pt-1' };
const ADMIN_NO_CO: SessionPayload = { sub: 'adm-0', role: 'admin' };

const P2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: 'test'
});

const input = (over: Partial<DealStageInput> = {}): DealStageInput => ({
  name: 'Первичный контакт',
  position: 0,
  statusAnchor: 'open',
  color: null,
  ...over
});

function makePrisma(opts: { rows?: unknown[]; before?: unknown } = {}) {
  const tx = {
    dealStage: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'st-new', ...data })),
      findUnique: vi.fn().mockResolvedValue(opts.before ?? null),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({})
    }
  };
  const prisma = {
    dealStage: { findMany: vi.fn().mockResolvedValue(opts.rows ?? []) },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx))
  };
  return { prisma: prisma as unknown as PrismaClient, raw: prisma, tx };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── роль-гейт ────────────────────────────────────────────────────────────────

describe('dealStages — роль-гейт', () => {
  it('admin и manager-leader проходят (list ok)', async () => {
    const { prisma } = makePrisma();
    expect((await listDealStages(prisma, ADMIN)).ok).toBe(true);
    expect((await listDealStages(prisma, LEADER)).ok).toBe(true);
  });

  it('рядовой менеджер → forbidden на всех операциях', async () => {
    const { prisma, raw } = makePrisma();
    expect(await listDealStages(prisma, PLAIN_MGR)).toEqual({ ok: false, error: 'forbidden' });
    expect(await createDealStage(prisma, PLAIN_MGR, input())).toEqual({ ok: false, error: 'forbidden' });
    expect(await updateDealStage(prisma, PLAIN_MGR, 'st-1', input())).toEqual({ ok: false, error: 'forbidden' });
    expect(await deleteDealStage(prisma, PLAIN_MGR, 'st-1')).toEqual({ ok: false, error: 'forbidden' });
    expect((raw.$transaction as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('partner (клиентский контур) → forbidden', async () => {
    const { prisma } = makePrisma();
    expect(await listDealStages(prisma, PARTNER)).toEqual({ ok: false, error: 'forbidden' });
    expect(await createDealStage(prisma, PARTNER, input())).toEqual({ ok: false, error: 'forbidden' });
  });

  it('без companyId → forbidden даже для admin', async () => {
    const { prisma } = makePrisma();
    expect(await listDealStages(prisma, ADMIN_NO_CO)).toEqual({ ok: false, error: 'forbidden' });
    expect(await createDealStage(prisma, ADMIN_NO_CO, input())).toEqual({ ok: false, error: 'forbidden' });
    expect(await deleteDealStage(prisma, ADMIN_NO_CO, 'st-1')).toEqual({ ok: false, error: 'forbidden' });
  });
});

// ─── валидация ────────────────────────────────────────────────────────────────

describe('dealStages — валидация входа', () => {
  it('пустое/пробельное имя → validation', async () => {
    const { prisma } = makePrisma();
    expect(await createDealStage(prisma, LEADER, input({ name: '   ' }))).toEqual({ ok: false, error: 'validation' });
  });

  it('кривой цвет (не #RRGGBB) → validation', async () => {
    const { prisma } = makePrisma();
    expect(await createDealStage(prisma, LEADER, input({ color: 'красный' }))).toEqual({ ok: false, error: 'validation' });
    expect(await createDealStage(prisma, LEADER, input({ color: '#GGGGGG' }))).toEqual({ ok: false, error: 'validation' });
  });

  it('неизвестный якорь статуса → validation', async () => {
    const { prisma } = makePrisma();
    expect(
      await createDealStage(prisma, LEADER, input({ statusAnchor: 'archived' as unknown as 'open' }))
    ).toEqual({ ok: false, error: 'validation' });
  });

  it('отрицательная позиция → validation (и на update тоже)', async () => {
    const { prisma } = makePrisma();
    expect(await createDealStage(prisma, LEADER, input({ position: -1 }))).toEqual({ ok: false, error: 'validation' });
    expect(await updateDealStage(prisma, LEADER, 'st-1', input({ position: -1 }))).toEqual({ ok: false, error: 'validation' });
  });
});

// ─── терминальность из якоря ──────────────────────────────────────────────────

describe('dealStages — isTerminal из якоря', () => {
  it.each([['won'], ['lost']] as const)('якорь %s → isTerminal=true даже без флага', async (anchor) => {
    const { prisma, tx } = makePrisma();
    const res = await createDealStage(prisma, LEADER, input({ statusAnchor: anchor, isTerminal: false }));
    expect(res.ok).toBe(true);
    expect(tx.dealStage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statusAnchor: anchor, isTerminal: true }) })
    );
  });

  it('якорь open без флага → isTerminal=false; с флагом → true', async () => {
    const { prisma, tx } = makePrisma();
    await createDealStage(prisma, LEADER, input());
    expect(tx.dealStage.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isTerminal: false }) })
    );
    await createDealStage(prisma, LEADER, input({ isTerminal: true }));
    expect(tx.dealStage.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isTerminal: true }) })
    );
  });
});

// ─── list / create ────────────────────────────────────────────────────────────

describe('listDealStages', () => {
  it('маппит строки компании в DealStageView (по позиции)', async () => {
    const rows = [
      { id: 'st-1', companyId: 'c1', createdAt: new Date(), updatedAt: new Date(), name: 'А', position: 0, statusAnchor: 'open', isTerminal: false, color: null },
      { id: 'st-2', companyId: 'c1', createdAt: new Date(), updatedAt: new Date(), name: 'Б', position: 1, statusAnchor: 'lost', isTerminal: true, color: '#EF4444' }
    ];
    const { prisma, raw } = makePrisma({ rows });
    expect(await listDealStages(prisma, LEADER)).toEqual({
      ok: true,
      rows: [
        { id: 'st-1', name: 'А', position: 0, statusAnchor: 'open', isTerminal: false, color: null },
        { id: 'st-2', name: 'Б', position: 1, statusAnchor: 'lost', isTerminal: true, color: '#EF4444' }
      ]
    });
    expect((raw.dealStage as { findMany: ReturnType<typeof vi.fn> }).findMany).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      orderBy: { position: 'asc' }
    });
  });
});

describe('createDealStage', () => {
  it('happy: строка компании сессии + аудит deal_stage_created в транзакции', async () => {
    const { prisma, tx } = makePrisma();
    expect(await createDealStage(prisma, LEADER, input({ color: '#3B82F6' }))).toEqual({ ok: true, id: 'st-new' });
    expect(tx.dealStage.create).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        name: 'Первичный контакт',
        position: 0,
        statusAnchor: 'open',
        color: '#3B82F6',
        isTerminal: false
      }
    });
    expect(recordAudit).toHaveBeenCalledWith(tx, {
      userId: 'ld-1',
      action: 'deal_stage_created',
      entity: 'deal_stage',
      entityId: 'st-new',
      after: expect.objectContaining({ name: 'Первичный контакт', position: 0 })
    });
  });

  it('занятая позиция (P2002) → position_taken', async () => {
    const { prisma, tx } = makePrisma();
    tx.dealStage.create.mockRejectedValue(P2002);
    expect(await createDealStage(prisma, LEADER, input())).toEqual({ ok: false, error: 'position_taken' });
  });

  it('прочая ошибка БД пробрасывается наружу', async () => {
    const { prisma, tx } = makePrisma();
    tx.dealStage.create.mockRejectedValue(new Error('db down'));
    await expect(createDealStage(prisma, LEADER, input())).rejects.toThrow('db down');
  });
});

// ─── update ───────────────────────────────────────────────────────────────────

describe('updateDealStage', () => {
  const before = { companyId: 'c1', name: 'Старое', position: 0, statusAnchor: 'open', color: null, isTerminal: false };

  it('happy: обновляет и пишет аудит с before/after (companyId скрыт)', async () => {
    const { prisma, tx } = makePrisma({ before });
    expect(await updateDealStage(prisma, ADMIN, 'st-1', input({ name: 'Новое', position: 5 }))).toEqual({ ok: true });
    expect(tx.dealStage.update).toHaveBeenCalledWith({
      where: { id: 'st-1' },
      data: { name: 'Новое', position: 5, statusAnchor: 'open', color: null, isTerminal: false }
    });
    expect(recordAudit).toHaveBeenCalledWith(tx, {
      userId: 'adm-1',
      action: 'deal_stage_updated',
      entity: 'deal_stage',
      entityId: 'st-1',
      before: expect.objectContaining({ name: 'Старое', companyId: undefined }),
      after: expect.objectContaining({ name: 'Новое', position: 5 })
    });
  });

  it('стадия чужой компании → not_found (IDOR), update не вызывается', async () => {
    const { prisma, tx } = makePrisma({ before: { ...before, companyId: 'c2' } });
    expect(await updateDealStage(prisma, LEADER, 'st-alien', input())).toEqual({ ok: false, error: 'not_found' });
    expect(tx.dealStage.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('несуществующая стадия → not_found', async () => {
    const { prisma } = makePrisma({ before: null });
    expect(await updateDealStage(prisma, LEADER, 'st-ghost', input())).toEqual({ ok: false, error: 'not_found' });
  });

  it('перенос на занятую позицию (P2002) → position_taken', async () => {
    const { prisma, tx } = makePrisma({ before });
    tx.dealStage.update.mockRejectedValue(P2002);
    expect(await updateDealStage(prisma, LEADER, 'st-1', input({ position: 7 }))).toEqual({
      ok: false,
      error: 'position_taken'
    });
  });

  it('прочая ошибка БД пробрасывается наружу', async () => {
    const { prisma, tx } = makePrisma({ before });
    tx.dealStage.update.mockRejectedValue(new Error('db down'));
    await expect(updateDealStage(prisma, LEADER, 'st-1', input())).rejects.toThrow('db down');
  });
});

// ─── delete ───────────────────────────────────────────────────────────────────

describe('deleteDealStage', () => {
  it('happy: удаляет и пишет аудит deal_stage_deleted', async () => {
    const { prisma, tx } = makePrisma({ before: { companyId: 'c1', name: 'Лишняя' } });
    expect(await deleteDealStage(prisma, LEADER, 'st-1')).toEqual({ ok: true });
    expect(tx.dealStage.delete).toHaveBeenCalledWith({ where: { id: 'st-1' } });
    expect(recordAudit).toHaveBeenCalledWith(tx, {
      userId: 'ld-1',
      action: 'deal_stage_deleted',
      entity: 'deal_stage',
      entityId: 'st-1',
      before: { name: 'Лишняя' }
    });
  });

  it('стадия чужой компании → not_found, delete не вызывается', async () => {
    const { prisma, tx } = makePrisma({ before: { companyId: 'c2', name: 'Чужая' } });
    expect(await deleteDealStage(prisma, LEADER, 'st-alien')).toEqual({ ok: false, error: 'not_found' });
    expect(tx.dealStage.delete).not.toHaveBeenCalled();
  });

  it('несуществующая стадия → not_found', async () => {
    const { prisma } = makePrisma({ before: null });
    expect(await deleteDealStage(prisma, ADMIN, 'st-ghost')).toEqual({ ok: false, error: 'not_found' });
  });

  it('прочая ошибка БД пробрасывается наружу', async () => {
    const { prisma, tx } = makePrisma({ before: { companyId: 'c1', name: 'X' } });
    tx.dealStage.delete.mockRejectedValue(new Error('db down'));
    await expect(deleteDealStage(prisma, LEADER, 'st-1')).rejects.toThrow('db down');
  });
});
