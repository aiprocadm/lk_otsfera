/**
 * Unit-тесты src/lib/services/deals/notes.ts (этап 6, PR-2, решение §10-1 ТЗ)
 * на prisma-моке.
 *
 *   - addNoteToDeal: staff-гейт (клиент → forbidden), invalid (пустое тело /
 *     одни пробелы), not_found вне скоупа, happy-путь (dealId + authorId,
 *     БЕЗ orderId — параллельная привязка), аудит entity 'deal';
 *   - listDealNotes: staff-гейт, скоуп в выборке сделки, маппинг author.name →
 *     authorName, orderBy createdAt desc + take 200.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { addNoteToDeal, listDealNotes } from '@/lib/services/deals/notes';

// ─── helpers ──────────────────────────────────────────────────────────────────

const MGR: SessionPayload = { sub: 'm-1', role: 'manager', companyId: 'c1' };
const PARTNER: SessionPayload = { sub: 'p-1', role: 'partner', partnerId: 'pt-1' };
const ORG: SessionPayload = { sub: 'o-1', role: 'organization', organizationId: 'org-1' };

function makePrisma(opts: { deal?: unknown; notes?: unknown[] } = {}) {
  const dealFindFirst = vi.fn().mockResolvedValue(opts.deal ?? null);
  const noteCreate = vi.fn().mockResolvedValue({ id: 'n-1' });
  const noteFindMany = vi.fn().mockResolvedValue(opts.notes ?? []);
  const prisma = {
    deal: { findFirst: dealFindFirst },
    dealNote: { create: noteCreate, findMany: noteFindMany }
  } as unknown as PrismaClient;
  return { prisma, dealFindFirst, noteCreate, noteFindMany };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── addNoteToDeal ────────────────────────────────────────────────────────────

describe('addNoteToDeal', () => {
  it.each([PARTNER, ORG])('клиентская роль ($role) → forbidden без запросов', async (session) => {
    const { prisma, dealFindFirst, noteCreate } = makePrisma();
    expect(await addNoteToDeal(prisma, session, { dealId: 'd-1', body: 'Заметка' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(dealFindFirst).not.toHaveBeenCalled();
    expect(noteCreate).not.toHaveBeenCalled();
  });

  it('тело вообще не передано → invalid, а не падение', async () => {
    // Сервис зовётся из route-хендлера с JSON-телом: типы там не действуют, поле
    // может просто отсутствовать. Ожидаем вежливый отказ, не TypeError.
    const { prisma, dealFindFirst, noteCreate } = makePrisma({ deal: { id: 'd-1' } });
    expect(await addNoteToDeal(prisma, MGR, { dealId: 'd-1' } as never)).toEqual({
      ok: false,
      error: 'invalid'
    });
    expect(dealFindFirst).not.toHaveBeenCalled();
    expect(noteCreate).not.toHaveBeenCalled();
  });

  it.each([['пустое тело', ''], ['одни пробелы', '   \n\t ']])(
    '%s → invalid, в БД не ходим',
    async (_label, body) => {
      const { prisma, dealFindFirst, noteCreate } = makePrisma({ deal: { id: 'd-1' } });
      expect(await addNoteToDeal(prisma, MGR, { dealId: 'd-1', body })).toEqual({
        ok: false,
        error: 'invalid'
      });
      expect(dealFindFirst).not.toHaveBeenCalled();
      expect(noteCreate).not.toHaveBeenCalled();
    }
  );

  it('сделка вне скоупа → not_found; скоуп менеджера в самой выборке', async () => {
    const { prisma, dealFindFirst, noteCreate } = makePrisma();
    expect(await addNoteToDeal(prisma, MGR, { dealId: 'd-alien', body: 'Заметка' })).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(dealFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: 'd-alien' }, { companyId: 'c1', managerId: 'm-1' }] }
      })
    );
    expect(noteCreate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('happy: dealId + authorId, тело trim-ится, orderId НЕ пишется (параллельная привязка)', async () => {
    const { prisma, noteCreate } = makePrisma({ deal: { id: 'd-1' } });
    expect(await addNoteToDeal(prisma, MGR, { dealId: 'd-1', body: '  Позвонить клиенту  ' })).toEqual({
      ok: true,
      id: 'n-1'
    });
    // Точный матч data: ключа orderId нет вовсе — заметка живёт только на сделке.
    expect(noteCreate).toHaveBeenCalledWith({
      data: { dealId: 'd-1', authorId: 'm-1', body: 'Позвонить клиенту' },
      select: { id: true }
    });
  });

  it('аудит deal_note_created с entity deal', async () => {
    const { prisma } = makePrisma({ deal: { id: 'd-1' } });
    await addNoteToDeal(prisma, MGR, { dealId: 'd-1', body: 'Заметка' });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'deal_note_created',
      entity: 'deal',
      entityId: 'd-1',
      userId: 'm-1',
      after: { noteId: expect.any(String) }
    });
  });
});

// ─── listDealNotes ────────────────────────────────────────────────────────────

describe('listDealNotes', () => {
  it('клиентская роль → forbidden без запросов', async () => {
    const { prisma, dealFindFirst } = makePrisma();
    expect(await listDealNotes(prisma, PARTNER, { dealId: 'd-1' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(dealFindFirst).not.toHaveBeenCalled();
  });

  it('сделка вне скоупа → not_found; заметки не запрашиваются', async () => {
    const { prisma, dealFindFirst, noteFindMany } = makePrisma();
    expect(await listDealNotes(prisma, MGR, { dealId: 'd-alien' })).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(dealFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: 'd-alien' }, { companyId: 'c1', managerId: 'm-1' }] }
      })
    );
    expect(noteFindMany).not.toHaveBeenCalled();
  });

  it('маппинг рядов: author.name → authorName; сортировка desc и take 200', async () => {
    const t1 = new Date('2026-07-20T10:00:00.000Z');
    const t2 = new Date('2026-07-21T10:00:00.000Z');
    const { prisma, noteFindMany } = makePrisma({
      deal: { id: 'd-1' },
      notes: [
        { id: 'n-2', body: 'Свежая', createdAt: t2, author: { name: 'Анна' } },
        { id: 'n-1', body: 'Старая', createdAt: t1, author: { name: 'Борис' } }
      ]
    });
    expect(await listDealNotes(prisma, MGR, { dealId: 'd-1' })).toEqual({
      ok: true,
      rows: [
        { id: 'n-2', body: 'Свежая', authorName: 'Анна', createdAt: t2 },
        { id: 'n-1', body: 'Старая', authorName: 'Борис', createdAt: t1 }
      ]
    });
    expect(noteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dealId: 'd-1' },
        orderBy: { createdAt: 'desc' },
        take: 200
      })
    );
  });

  it('пустой список заметок → ok с пустыми rows', async () => {
    const { prisma } = makePrisma({ deal: { id: 'd-1' } });
    expect(await listDealNotes(prisma, MGR, { dealId: 'd-1' })).toEqual({ ok: true, rows: [] });
  });
});
