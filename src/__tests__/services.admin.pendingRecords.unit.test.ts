/**
 * Unit tests for src/lib/services/admin/pendingRecords.ts (G1).
 * Мок-prisma по образцу services.admin.syncControl.test.ts; ветки, недостижимые
 * без живого Postgres, добираются в admin.pendingRecords.integration.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { warn } }));

import { listPendingRecords, requeueDeadRecord } from '@/lib/services/admin/pendingRecords';
import type { SessionPayload } from '@/lib/auth/jwt';

const ADMIN: SessionPayload = { sub: 'adm-1', role: 'admin' };
const MANAGER: SessionPayload = { sub: 'mgr-1', role: 'manager' };

function makePrisma(
  over: {
    rows?: unknown[];
    found?: { status: string } | null;
    updatedCount?: number;
    auditRejects?: boolean;
  } = {}
) {
  const findMany = vi.fn().mockResolvedValue(over.rows ?? []);
  const findUnique = vi.fn().mockResolvedValue(over.found ?? null);
  const updateMany = vi.fn().mockResolvedValue({ count: over.updatedCount ?? 1 });
  const create = over.auditRejects
    ? vi.fn().mockRejectedValue(new Error('audit down'))
    : vi.fn().mockResolvedValue({});
  const prisma = { oneCPendingRecord: { findMany, findUnique, updateMany }, auditLog: { create } };
  return { prisma: prisma as never, findMany, findUnique, updateMany, create };
}

describe('listPendingRecords', () => {
  it('не-admin → forbidden, без запроса к БД', async () => {
    const { prisma, findMany } = makePrisma();
    expect(await listPendingRecords(prisma, MANAGER)).toEqual({ ok: false, error: 'forbidden' });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('select БЕЗ dto (сырые ПДн из 1С не отдаются), orderBy dead-first + lastTriedAt desc, take 100', async () => {
    const { prisma, findMany } = makePrisma();
    const res = await listPendingRecords(prisma, ADMIN);
    expect(res).toEqual({ ok: true, records: [] });
    expect(findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        entity: true,
        externalId: true,
        reason: true,
        attempts: true,
        status: true,
        firstSeenAt: true,
        lastTriedAt: true,
      },
      orderBy: [{ status: 'asc' }, { lastTriedAt: 'desc' }],
      take: 100,
    });
    // Точный ассерт отсутствия dto в select — «дельта» на случай расширения select.
    const arg = findMany.mock.calls[0][0];
    expect(arg.select).not.toHaveProperty('dto');
  });

  it('возвращает строки из prisma как records', async () => {
    const row = {
      id: 'p1',
      entity: 'payment',
      externalId: 'PAY-1',
      reason: 'organization_not_found',
      attempts: 2,
      status: 'pending',
      firstSeenAt: new Date('2026-07-01T00:00:00Z'),
      lastTriedAt: new Date('2026-07-02T00:00:00Z'),
    };
    const { prisma } = makePrisma({ rows: [row] });
    expect(await listPendingRecords(prisma, ADMIN)).toEqual({ ok: true, records: [row] });
  });
});

describe('requeueDeadRecord', () => {
  it('не-admin → forbidden, без чтения записи', async () => {
    const { prisma, findUnique } = makePrisma();
    expect(await requeueDeadRecord(prisma, MANAGER, 'p1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('запись не существует → not_found', async () => {
    const { prisma, updateMany } = makePrisma({ found: null });
    expect(await requeueDeadRecord(prisma, ADMIN, 'nope')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('статус pending → not_dead без записи', async () => {
    const { prisma, updateMany } = makePrisma({ found: { status: 'pending' } });
    expect(await requeueDeadRecord(prisma, ADMIN, 'p1')).toEqual({ ok: false, error: 'not_dead' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('CAS-гонка: updateMany count=0 (кто-то успел раньше) → not_dead, аудит не пишется', async () => {
    const { prisma, create } = makePrisma({ found: { status: 'dead' }, updatedCount: 0 });
    expect(await requeueDeadRecord(prisma, ADMIN, 'p1')).toEqual({ ok: false, error: 'not_dead' });
    expect(create).not.toHaveBeenCalled();
  });

  it('успех: CAS updateMany {id, status:dead} → {pending, attempts:0} + аудит one_c_pending_requeued', async () => {
    const { prisma, findUnique, updateMany, create } = makePrisma({ found: { status: 'dead' } });
    const res = await requeueDeadRecord(prisma, ADMIN, 'p1');
    expect(res).toEqual({ ok: true });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'p1' }, select: { status: true } });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'dead' },
      data: { status: 'pending', attempts: 0 },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'adm-1',
          action: 'one_c_pending_requeued',
          entity: 'one_c_pending',
          entityId: 'p1',
          meta: expect.objectContaining({ after: { status: 'pending', attempts: 0 } }),
        }),
      })
    );
  });

  it('сбой аудита проглатывается (graceful §3): запись уже возвращена → ok:true + log.warn', async () => {
    const { prisma } = makePrisma({ found: { status: 'dead' }, auditRejects: true });
    expect(await requeueDeadRecord(prisma, ADMIN, 'p1')).toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
  });
});
