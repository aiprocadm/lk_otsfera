/**
 * Этап 7 (ФТ-7.3/7.1) — taskFiltersWhere (композиция фильтров поверх охвата
 * профиля), listTaskBoard с фильтрами, listLinkedTasks (панели лида/сделки),
 * новые поля TaskCard (лид/сделка). Prisma-фейки, стиль cov.tasks.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

import { taskFiltersWhere, listTaskBoard, listLinkedTasks } from '@/lib/services/tasks/board';

const NOW = new Date('2026-07-26T12:00:00Z');

const manager = (over: Record<string, unknown> = {}): SessionPayload =>
  ({
    sub: 'm1',
    role: 'manager',
    companyId: 'co-A',
    managedOrgIds: [],
    ...over,
  }) as unknown as SessionPayload;

const TASK_ROW = {
  id: 't1',
  title: 'T',
  description: null,
  priority: null,
  dueDate: null,
  completedAt: null,
  status: 'todo',
  columnId: null,
  createdAt: NOW,
  linkedOrderId: null,
  linkedOrganizationId: null,
  linkedLeadId: 'l1',
  linkedDealId: 'd1',
  createdBy: { name: 'Автор' },
  assignees: [{ userId: 'u1', user: { name: 'Исполнитель' } }],
  linkedOrder: null,
  linkedOrganization: null,
  linkedLead: { subject: 'Лид-тема' },
  linkedDeal: { title: 'Сделка-1' },
};

function fakePrisma(
  rows: unknown[] = [TASK_ROW],
  columns: unknown[] = []
): { prisma: PrismaClient; findMany: ReturnType<typeof vi.fn> } {
  const findMany = vi.fn().mockResolvedValue(rows);
  const prisma = {
    taskColumn: { findMany: vi.fn().mockResolvedValue(columns) },
    task: { findMany, count: vi.fn().mockResolvedValue(rows.length) },
  } as unknown as PrismaClient;
  return { prisma, findMany };
}

describe('taskFiltersWhere', () => {
  it('без фильтров — только охват профиля (company-floor)', () => {
    expect(taskFiltersWhere(manager(), undefined, NOW)).toEqual({ companyId: 'co-A' });
    expect(taskFiltersWhere(manager(), {}, NOW)).toEqual({ companyId: 'co-A' });
  });

  it('scope=mine — создатель или исполнитель поверх floor', () => {
    const w = taskFiltersWhere(manager(), { scope: 'mine' }, NOW);
    expect(w).toEqual({
      AND: [
        { companyId: 'co-A' },
        { OR: [{ createdById: 'm1' }, { assignees: { some: { userId: 'm1' } } }] },
      ],
    });
  });

  it('assigneeId — фильтр по исполнителю (ФТ-7.3, лидер)', () => {
    const w = taskFiltersWhere(manager(), { assigneeId: 'm2' }, NOW);
    expect(w).toEqual({
      AND: [{ companyId: 'co-A' }, { assignees: { some: { userId: 'm2' } } }],
    });
  });

  it('overdue — срок в прошлом и статус не done', () => {
    const w = taskFiltersWhere(manager(), { overdue: true }, NOW);
    expect(w).toEqual({
      AND: [{ companyId: 'co-A' }, { dueDate: { lt: NOW }, status: { not: 'done' } }],
    });
  });

  it('комбинация всех фильтров', () => {
    const w = taskFiltersWhere(
      manager(),
      { scope: 'mine', assigneeId: 'm2', overdue: true },
      NOW
    ) as {
      AND: unknown[];
    };
    expect(w.AND).toHaveLength(4);
  });

  it('уважает охват профиля own (фильтры не расширяют видимость)', () => {
    const s = manager({ accessProfile: { tasks: 'own', capabilities: [] } });
    const w = taskFiltersWhere(s, { overdue: true }, NOW) as { AND: unknown[] };
    // base сам является AND-структурой floor+mine; фильтр добавляется сверху
    expect(w.AND).toHaveLength(2);
  });
});

describe('listTaskBoard с фильтрами', () => {
  it('прокидывает составной where и маппит поля лида/сделки в TaskCard', async () => {
    const { prisma, findMany } = fakePrisma();
    const board = await listTaskBoard(prisma, manager(), { scope: 'mine' });

    const where = findMany.mock.calls[0]![0].where;
    expect(where.AND).toBeDefined();

    const cards = board.board.flatMap((c) => c.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      linkedLeadId: 'l1',
      linkedLeadSubject: 'Лид-тема',
      linkedDealId: 'd1',
      linkedDealTitle: 'Сделка-1',
    });
  });
});

describe('listLinkedTasks (ФТ-7.1)', () => {
  it('клиентская роль → пусто (задачи строго внутренние)', async () => {
    const { prisma, findMany } = fakePrisma();
    const rows = await listLinkedTasks(
      prisma,
      { sub: 'p1', role: 'partner' } as unknown as SessionPayload,
      { leadId: 'l1' }
    );
    expect(rows).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('сотрудник без companyId → пусто (fail-safe)', async () => {
    const { prisma } = fakePrisma();
    const rows = await listLinkedTasks(prisma, manager({ companyId: null }), { leadId: 'l1' });
    expect(rows).toEqual([]);
  });

  it('лид: where = охват AND linkedLeadId; карточки смапплены', async () => {
    const { prisma, findMany } = fakePrisma();
    const rows = await listLinkedTasks(prisma, manager(), { leadId: 'l1' });

    expect(findMany.mock.calls[0]![0].where).toEqual({
      AND: [{ companyId: 'co-A' }, { linkedLeadId: 'l1' }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.linkedLeadSubject).toBe('Лид-тема');
  });

  it('сделка: where по linkedDealId', async () => {
    const { prisma, findMany } = fakePrisma();
    await listLinkedTasks(prisma, manager(), { dealId: 'd1' });
    expect(findMany.mock.calls[0]![0].where).toEqual({
      AND: [{ companyId: 'co-A' }, { linkedDealId: 'd1' }],
    });
  });

  it('задача, чей статус не покрыт кастомными колонками, отфильтровывается', async () => {
    // Кастомный набор колонок без якоря todo → columnForTask вернёт undefined.
    const customColumns = [
      {
        id: 'c-done',
        name: 'Готово',
        position: 0,
        statusAnchor: 'done',
        isDoneColumn: true,
        color: null,
      },
    ];
    const { prisma } = fakePrisma([TASK_ROW], customColumns);
    const rows = await listLinkedTasks(prisma, manager(), { leadId: 'l1' });
    expect(rows).toEqual([]);
  });

  it('admin видит задачи (Model A)', async () => {
    const { prisma } = fakePrisma();
    const rows = await listLinkedTasks(
      prisma,
      { sub: 'a1', role: 'admin', companyId: 'co-A' } as unknown as SessionPayload,
      { leadId: 'l1' }
    );
    expect(rows).toHaveLength(1);
  });
});
