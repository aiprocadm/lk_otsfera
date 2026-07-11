/**
 * Unit tests for src/lib/services/admin/piiAccess.ts.
 * Фильтры/cursor — по образцу services.admin.auditLog.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { listPiiAccess, listPiiAccessFilters } from '@/lib/services/admin/piiAccess';
import type { SessionPayload } from '@/lib/auth/jwt';

const ADMIN: SessionPayload = { sub: 'adm', role: 'admin' };
const MANAGER: SessionPayload = { sub: 'mgr', role: 'manager' };

function eventRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    createdAt: new Date('2026-07-11T10:00:00Z'),
    userId: 'u1',
    user: { id: 'u1', email: 'e@x.ru', name: 'Емп' },
    userRole: 'manager',
    companyId: 'co-1',
    context: 'manager_students_list',
    action: 'list',
    subjectType: 'student',
    subjectIds: ['s1'],
    subjectCount: 1,
    meta: null,
    ...over
  };
}

function makePrisma(rows: ReturnType<typeof eventRow>[] = []) {
  return {
    piiAccessEvent: {
      findMany: vi.fn().mockResolvedValue(rows)
    },
    student: { findMany: vi.fn().mockResolvedValue([{ id: 's1', name: 'Иван И.' }]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    lead: { findMany: vi.fn().mockResolvedValue([]) },
    enrollmentRequest: { findMany: vi.fn().mockResolvedValue([]) },
    call: { findMany: vi.fn().mockResolvedValue([]) },
    inboundMessage: { findMany: vi.fn().mockResolvedValue([]) }
  } as never;
}

describe('listPiiAccess', () => {
  it('не-admin → forbidden', async () => {
    const res = await listPiiAccess(makePrisma(), MANAGER, {});
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('маппит строки, резолвит субъектов батчем, nextCursor=null без следующей страницы', async () => {
    const p = makePrisma([eventRow('ev1')]);
    const res = await listPiiAccess(p, ADMIN, {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]).toMatchObject({
      id: 'ev1',
      context: 'manager_students_list',
      labelRu: 'Список слушателей',
      subjects: [{ id: 's1', label: 'Иван И.' }]
    });
    expect(res.nextCursor).toBeNull();
    // батч-резолв: один findMany по студентам, без per-row запросов
    expect((p as any).student.findMany).toHaveBeenCalledTimes(1);
  });

  it('cursor-пагинация: take+1 строк → nextCursor = id последней видимой', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => eventRow(`ev${i}`));
    const p = makePrisma(rows);
    const res = await listPiiAccess(p, ADMIN, { take: 2 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows).toHaveLength(2);
    expect(res.nextCursor).toBe('ev1');
  });

  it('фильтры транслируются в where (subjectId → has, точные поля, период)', async () => {
    const p = makePrisma();
    await listPiiAccess(p, ADMIN, {
      actorUserId: 'u1',
      userRole: 'leader',
      context: 'calls_list',
      subjectType: 'caller',
      subjectId: 'c42',
      from: new Date('2026-07-01'),
      to: new Date('2026-07-11')
    });
    const arg = (p as any).piiAccessEvent.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      userId: 'u1',
      userRole: 'leader',
      context: 'calls_list',
      subjectType: 'caller',
      subjectIds: { has: 'c42' },
      createdAt: { gte: new Date('2026-07-01'), lte: new Date('2026-07-11') }
    });
  });

  it('take зажимается в [1, 100]', async () => {
    const p = makePrisma();
    await listPiiAccess(p, ADMIN, { take: 5000 });
    expect((p as any).piiAccessEvent.findMany.mock.calls[0][0].take).toBe(101);
  });

  it('нерезолвнутый субъект отдаётся как id с пометкой', async () => {
    const p = makePrisma([eventRow('ev1', { subjectIds: ['ghost'], subjectType: 'student' })]);
    (p as any).student.findMany.mockResolvedValue([]);
    const res = await listPiiAccess(p, ADMIN, {});
    if (!res.ok) throw new Error('expected ok');
    expect(res.rows[0].subjects).toEqual([{ id: 'ghost', label: 'ghost (удалён)' }]);
  });
});

describe('listPiiAccessFilters', () => {
  it('не-admin → forbidden; admin получает контексты из реестра и акторов', async () => {
    expect(await listPiiAccessFilters(makePrisma(), MANAGER)).toEqual({ ok: false, error: 'forbidden' });
    const p = makePrisma();
    (p as any).piiAccessEvent.findMany.mockResolvedValue([{ userId: 'u1' }]);
    (p as any).user.findMany.mockResolvedValue([{ id: 'u1', name: 'Емп', email: 'e@x.ru' }]);
    const res = await listPiiAccessFilters(p, ADMIN);
    if (!res.ok) throw new Error('expected ok');
    expect(res.contexts.find((c) => c.key === 'calls_list')?.labelRu).toBe('Журнал звонков');
    expect(res.actors).toEqual([{ id: 'u1', name: 'Емп', email: 'e@x.ru' }]);
  });
});
