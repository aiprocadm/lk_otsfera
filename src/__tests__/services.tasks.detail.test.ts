import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getTaskDetail } from '@/lib/services/tasks/detail';

/**
 * Карточка задачи (`У-218`, этап 4 PR-1).
 *
 * Главное, что здесь проверяется, — гард выборки. Страница зовёт `canSeeTask`
 * сама, но выборка обязана отказывать независимо: скрытая ссылка — это внешний
 * вид, а не защита (§4 defense-in-depth). Чужая задача отвечает `not_found`, а
 * не `forbidden`, иначе по коду ответа можно перебрать чужие id.
 */

const taskFindUnique = vi.fn();
const columnFindMany = vi.fn();
const commentFindMany = vi.fn();
const itemFindMany = vi.fn();
const auditFindMany = vi.fn();

const prisma = {
  task: { findUnique: taskFindUnique },
  taskColumn: { findMany: columnFindMany },
  taskComment: { findMany: commentFindMany },
  taskChecklistItem: { findMany: itemFindMany },
  auditLog: { findMany: auditFindMany },
} as unknown as PrismaClient;

const manager = { sub: 'u1', role: 'manager', companyId: 'co-1' } as SessionPayload;

const ROW = {
  id: 't1',
  title: 'Проверить документы',
  description: 'Подробности',
  status: 'in_progress',
  priority: 'high',
  dueDate: new Date('2026-09-20'),
  completedAt: null,
  createdAt: new Date('2026-09-01'),
  createdById: 'u1',
  createdByRuleId: null,
  columnId: null,
  companyId: 'co-1',
  linkedOrderId: 'ord1',
  linkedOrganizationId: 'org1',
  linkedLeadId: null,
  linkedDealId: null,
  createdBy: { name: 'Пётр' },
  assignees: [{ userId: 'u1', user: { name: 'Иван' } }],
  linkedOrder: { title: 'Заказ №1' },
  linkedOrganization: { name: 'ООО Ромашка' },
  linkedLead: null,
  linkedDeal: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  taskFindUnique.mockResolvedValue(ROW);
  columnFindMany.mockResolvedValue([]);
  commentFindMany.mockResolvedValue([]);
  itemFindMany.mockResolvedValue([]);
  auditFindMany.mockResolvedValue([]);
});

describe('getTaskDetail — доступ', () => {
  it('сессия без компании — forbidden, базу не трогаем', async () => {
    const res = await getTaskDetail(
      prisma,
      { ...manager, companyId: null } as SessionPayload,
      't1'
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(taskFindUnique).not.toHaveBeenCalled();
  });

  it('задачи нет — not_found', async () => {
    taskFindUnique.mockResolvedValue(null);
    expect(await getTaskDetail(prisma, manager, 'нет')).toEqual({ ok: false, error: 'not_found' });
  });

  it('ЧУЖАЯ КОМПАНИЯ — not_found, а не forbidden', async () => {
    taskFindUnique.mockResolvedValue({ ...ROW, companyId: 'co-2' });
    expect(await getTaskDetail(prisma, manager, 't1')).toEqual({ ok: false, error: 'not_found' });
  });

  it('охват «own»: чужая задача той же компании не открывается', async () => {
    taskFindUnique.mockResolvedValue({
      ...ROW,
      createdById: 'someone',
      assignees: [{ userId: 'someone', user: { name: 'Другой' } }],
    });
    const scoped = {
      ...manager,
      accessProfile: { tasks: 'own' },
    } as unknown as SessionPayload;
    expect(await getTaskDetail(prisma, scoped, 't1')).toEqual({ ok: false, error: 'not_found' });
  });

  it('администратор видит задачу любой компании (Model A)', async () => {
    taskFindUnique.mockResolvedValue({ ...ROW, companyId: 'co-2' });
    const admin = { sub: 'a1', role: 'admin', companyId: 'co-1' } as SessionPayload;
    const res = await getTaskDetail(prisma, admin, 't1');
    expect(res.ok).toBe(true);
  });
});

describe('getTaskDetail — что отдаёт', () => {
  it('собирает карточку целиком', async () => {
    const res = await getTaskDetail(prisma, manager, 't1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.task.title).toBe('Проверить документы');
    expect(res.task.createdByName).toBe('Пётр');
    expect(res.task.assignees).toEqual([{ id: 'u1', name: 'Иван' }]);
  });

  it('связи — только заполненные, каждая со своим видом и названием', async () => {
    const res = await getTaskDetail(prisma, manager, 't1');
    if (!res.ok) throw new Error('ожидали успех');
    expect(res.task.links).toEqual([
      { kind: 'order', id: 'ord1', title: 'Заказ №1' },
      { kind: 'organization', id: 'org1', title: 'ООО Ромашка' },
    ]);
  });

  it('лид и сделка тоже попадают в связи', async () => {
    taskFindUnique.mockResolvedValue({
      ...ROW,
      linkedOrderId: null,
      linkedOrganizationId: null,
      linkedOrder: null,
      linkedOrganization: null,
      linkedLeadId: 'l1',
      linkedLead: { subject: 'Заявка с сайта' },
      linkedDealId: 'd1',
      linkedDeal: { title: 'Сделка №7' },
    });
    const res = await getTaskDetail(prisma, manager, 't1');
    if (!res.ok) throw new Error('ожидали успех');
    expect(res.task.links).toEqual([
      { kind: 'lead', id: 'l1', title: 'Заявка с сайта' },
      { kind: 'deal', id: 'd1', title: 'Сделка №7' },
    ]);
  });

  it('связь есть, а названия нет — показываем вид объекта, а не пустую ссылку', async () => {
    taskFindUnique.mockResolvedValue({ ...ROW, linkedOrder: null, linkedOrganization: null });
    const res = await getTaskDetail(prisma, manager, 't1');
    if (!res.ok) throw new Error('ожидали успех');
    expect(res.task.links.map((l) => l.title)).toEqual(['Заказ', 'Организация']);
  });

  it('история берётся по этой задаче, свежая сверху, с русскими названиями', async () => {
    auditFindMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'task_created',
        createdAt: new Date('2026-09-01'),
        user: { name: 'Пётр' },
      },
      { id: 'a2', action: 'task_moved', createdAt: new Date('2026-09-02'), user: null },
    ]);
    const res = await getTaskDetail(prisma, manager, 't1');
    if (!res.ok) throw new Error('ожидали успех');
    expect(auditFindMany.mock.calls[0][0].where).toEqual({ entity: 'task', entityId: 't1' });
    expect(auditFindMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(res.task.history[0]).toEqual({
      id: 'a1',
      at: new Date('2026-09-01'),
      action: 'Создание задачи',
      actorName: 'Пётр',
    });
    // Действие системы: имени нет, и выдумывать его нельзя.
    expect(res.task.history[1]?.actorName).toBeNull();
  });

  it('`У-223`: задача, созданная правилом, честно об этом говорит', async () => {
    taskFindUnique.mockResolvedValue({ ...ROW, createdByRuleId: 'rule-1' });
    const res = await getTaskDetail(prisma, manager, 't1');
    if (!res.ok) throw new Error('ожидали успех');
    expect(res.task.createdByRuleId).toBe('rule-1');
  });
});
