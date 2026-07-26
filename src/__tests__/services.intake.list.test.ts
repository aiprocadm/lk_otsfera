/**
 * Этап 7 (ФТ-8.1/8.3/8.4) — union-ридер Intake: критерии источников,
 * нормализация, сортировка по ожиданию, slaLevel, фильтры лидера, пагинация,
 * forbidden для клиентов; countIntake и getStaffBadges.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import {
  listIntake,
  countIntake,
  slaLevelFor,
  intakeCallWhere,
  intakeClientRequestWhere,
  intakeInboundWhere,
  intakeEnrollmentWhere
} from '@/lib/services/intake/list';
import { getStaffBadges } from '@/lib/services/intake/badges';

const manager = (): SessionPayload => ({ sub: 'm1', role: 'manager', companyId: 'co-A' } as unknown as SessionPayload);
const partner = (): SessionPayload => ({ sub: 'p1', role: 'partner' } as unknown as SessionPayload);

const H = 3_600_000;
const now = Date.now();
const ago = (hours: number) => new Date(now - hours * H);

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    clientRequest: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    enrollmentRequest: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    inboundMessage: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    call: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    task: { count: vi.fn().mockResolvedValue(0) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    ...over
  };
  return { prisma: base as unknown as PrismaClient, base };
}

beforeEach(() => recordPiiAccess.mockReset().mockResolvedValue(undefined));

describe('slaLevelFor и where-критерии', () => {
  it('пороги: ≤4ч ok, >4ч warning, >24ч breach', () => {
    expect(slaLevelFor(1 * H)).toBe('ok');
    expect(slaLevelFor(4 * H)).toBe('ok');
    expect(slaLevelFor(5 * H)).toBe('warning');
    expect(slaLevelFor(25 * H)).toBe('breach');
  });

  it('критерии: заявки submitted|in_triage, обучение pending, обращения unresolved, звонок без привязки/лида/закрытия', () => {
    const s = manager();
    expect(intakeClientRequestWhere(s)).toMatchObject({ AND: [expect.anything(), { status: { in: ['submitted', 'in_triage'] } }] });
    expect(intakeEnrollmentWhere()).toEqual({ status: 'pending' });
    expect(intakeInboundWhere(s)).toMatchObject({ AND: [expect.anything(), { status: 'unresolved' }] });
    expect(intakeCallWhere(s)).toEqual({
      AND: [
        { OR: [{ companyId: 'co-A' }, { companyId: null }] },
        { direction: 'inbound', resolvedOrgId: null, contactId: null, intakeClosedAt: null, lead: null }
      ]
    });
  });
});

describe('listIntake', () => {
  it('клиентская роль → forbidden', async () => {
    const { prisma } = makePrisma();
    expect(await listIntake(prisma, partner())).toEqual({ ok: false, error: 'forbidden' });
  });

  it('нормализует 4 источника, сортирует «дольше ждёт — выше», резолвит имена, ставит slaLevel', async () => {
    const { prisma } = makePrisma({
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'r1', createdAt: ago(30), companyName: 'ООО Ромашка', subject: 'Обучение', status: 'in_triage', triagedByUserId: 'm2', organizationId: 'org-1' }
        ]),
        count: vi.fn()
      },
      enrollmentRequest: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'e1', createdAt: ago(5), claimedByUserId: null, organizationId: null, legacyCourseTitle: null, organization: { name: 'ООО Лютик' }, partner: null, direction: { name: 'Высота' }, items: [{ id: 'x' }, { id: 'y' }] }
        ]),
        count: vi.fn()
      },
      inboundMessage: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'i1', createdAt: ago(1), channel: 'email', senderDisplay: 'Пётр', senderRef: 'p@x.ru', subject: 'Вопрос', body: 'Текст обращения', claimedByUserId: null, resolvedOrgId: null }
        ]),
        count: vi.fn()
      },
      call: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'c1', createdAt: ago(2), callerNumber: '+79990000000', durationSec: 30, status: 'answered', claimedByUserId: null }
        ]),
        count: vi.fn()
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'm2', name: 'Мария' }]) }
    });

    const res = await listIntake(prisma, manager());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const items = res.result.items;
    // Старейшее (30ч) — первым.
    expect(items.map((i) => i.id)).toEqual(['r1', 'e1', 'c1', 'i1']);
    expect(items[0]).toMatchObject({ type: 'client_request', slaLevel: 'breach', responsibleName: 'Мария', from: 'ООО Ромашка' });
    expect(items[1]).toMatchObject({ type: 'enrollment', slaLevel: 'warning', essence: 'Высота · слушателей: 2', from: 'ООО Лютик' });
    expect(items[2]).toMatchObject({ type: 'call', slaLevel: 'ok', taskTitle: 'Перезвонить: +79990000000' });
    expect(items[2]!.leadPrefill).toMatchObject({ contactPhone: '+79990000000' });
    expect(items[3]).toMatchObject({ type: 'inbound', from: 'Пётр' });
    expect(items[3]!.leadPrefill).toMatchObject({ contactEmail: 'p@x.ru' });
    expect(res.result.total).toBe(4);
    // ПДн-журнал: только inbound/call строки.
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, expect.objectContaining({ context: 'intake_list', subjectIds: ['c1', 'i1'] }));
  });

  it('фильтры лидера: onlyUnassigned и assigneeId', async () => {
    const rows = [
      { id: 'r1', createdAt: ago(3), companyName: 'A', subject: 's', status: 'in_triage', triagedByUserId: 'm2', organizationId: null },
      { id: 'r2', createdAt: ago(2), companyName: 'B', subject: 's', status: 'submitted', triagedByUserId: null, organizationId: null }
    ];
    const { prisma } = makePrisma({
      clientRequest: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn() },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'm2', name: 'М' }]) }
    });

    const unassigned = await listIntake(prisma, manager(), { onlyUnassigned: true });
    expect(unassigned.ok && unassigned.result.items.map((i) => i.id)).toEqual(['r2']);

    const byAssignee = await listIntake(prisma, manager(), { assigneeId: 'm2' });
    expect(byAssignee.ok && byAssignee.result.items.map((i) => i.id)).toEqual(['r1']);
  });

  it('пагинация после merge: total полный, страница усечена', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`, createdAt: ago(5 - i), companyName: 'A', subject: 's', status: 'submitted' as const, triagedByUserId: null, organizationId: null
    }));
    const { prisma } = makePrisma({ clientRequest: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn() } });
    const res = await listIntake(prisma, manager(), { page: 2, pageSize: 2 });
    expect(res.ok && res.result.total).toBe(5);
    expect(res.ok && res.result.items).toHaveLength(2);
    expect(res.ok && res.result.items.map((i) => i.id)).toEqual(['r2', 'r3']);
  });

  it('submitted-заявка без triage не имеет ответственного (triagedByUserId прошлого триажа игнорируется)', async () => {
    const rows = [{ id: 'r1', createdAt: ago(1), companyName: 'A', subject: 's', status: 'submitted', triagedByUserId: 'm9', organizationId: null }];
    const { prisma } = makePrisma({ clientRequest: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn() } });
    const res = await listIntake(prisma, manager());
    expect(res.ok && res.result.items[0]!.responsibleUserId).toBeNull();
  });
});

describe('countIntake / getStaffBadges', () => {
  it('счётчик — сумма 4 count-запросов; клиенту 0', async () => {
    const { prisma } = makePrisma({
      clientRequest: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(2) },
      enrollmentRequest: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(3) },
      inboundMessage: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(4) },
      call: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(1) }
    });
    expect(await countIntake(prisma, manager())).toBe(10);
    expect(await countIntake(prisma, partner())).toBe(0);
  });

  it('getStaffBadges собирает intake + просроченные задачи', async () => {
    const { prisma, base } = makePrisma({
      clientRequest: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(1) },
      task: { count: vi.fn().mockResolvedValue(7) }
    });
    expect(await getStaffBadges(prisma, manager())).toEqual({ intake: 1, tasksOverdue: 7 });
    const where = (base.task.count as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
    expect(JSON.stringify(where)).toContain('dueDate');
  });
});
