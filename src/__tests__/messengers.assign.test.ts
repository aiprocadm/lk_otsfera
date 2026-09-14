import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const m = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  notifyDialogAssigned: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: m.recordAudit }));
vi.mock('@/lib/notifications/manager', () => ({ notifyDialogAssigned: m.notifyDialogAssigned }));

import {
  assignDialog,
  claimDialogOnFirstReply,
  listAssignableStaff,
  takeDialog,
} from '@/lib/services/messengers/assign';

/**
 * Ответственный за диалог (`У-206`, спека этапа 3 §3.6): скоуп, проверка
 * назначаемого, отметки «кто и когда», аудит с содержимым `after`,
 * уведомление новому — и правило первого ответившего.
 */
const dialogFindUnique = vi.fn();
const dialogUpdate = vi.fn();
const dialogUpdateMany = vi.fn();
const userFindFirst = vi.fn();
const userFindMany = vi.fn();
const prisma = {
  messengerDialog: {
    findUnique: dialogFindUnique,
    update: dialogUpdate,
    updateMany: dialogUpdateMany,
  },
  user: { findFirst: userFindFirst, findMany: userFindMany },
} as unknown as PrismaClient;

const session = { sub: 'me', role: 'manager', companyId: 'c1' } as SessionPayload;
/** Диалог своей компании без ответственного. */
const own = { id: 'd1', companyId: 'c1', assigneeId: null };

describe('assignDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogFindUnique.mockResolvedValue(own);
    dialogUpdate.mockResolvedValue({});
    userFindFirst.mockResolvedValue({ id: 'u2' });
    m.notifyDialogAssigned.mockResolvedValue({
      recipientsNotified: 1,
      emailsSent: 1,
      emailsSkipped: 0,
    });
  });

  it('сессия без компании → forbidden, база не спрашивается', async () => {
    const r = await assignDialog(
      prisma,
      { ...session, companyId: null },
      { dialogId: 'd1', assigneeId: 'u2' }
    );
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(dialogFindUnique).not.toHaveBeenCalled();
  });

  it('нет диалога или чужая компания → not_found (существование чужой переписки не раскрываем)', async () => {
    dialogFindUnique.mockResolvedValueOnce(null);
    await expect(
      assignDialog(prisma, session, { dialogId: 'x', assigneeId: 'u2' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    dialogFindUnique.mockResolvedValueOnce({ ...own, companyId: 'other' });
    await expect(
      assignDialog(prisma, session, { dialogId: 'd1', assigneeId: 'u2' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    expect(dialogUpdate).not.toHaveBeenCalled();
  });

  it('назначаемый не проходит проверку (чужая компания, уволен, не менеджер) → invalid_assignee', async () => {
    userFindFirst.mockResolvedValue(null);
    await expect(
      assignDialog(prisma, session, { dialogId: 'd1', assigneeId: 'stranger' })
    ).resolves.toEqual({ ok: false, error: 'invalid_assignee' });
    // Все три условия отсекаются одним запросом — проверяем его целиком.
    expect(userFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'stranger',
        companyId: 'c1',
        role: { in: ['manager', 'leader'] },
        isActive: true,
      },
      select: { id: true },
    });
    expect(dialogUpdate).not.toHaveBeenCalled();
    expect(m.recordAudit).not.toHaveBeenCalled();
  });

  it('повтор того же значения → changed:false, без записи, аудита и уведомления', async () => {
    dialogFindUnique.mockResolvedValueOnce({ ...own, assigneeId: 'u2' });
    await expect(
      assignDialog(prisma, session, { dialogId: 'd1', assigneeId: 'u2' })
    ).resolves.toEqual({ ok: true, changed: false });
    expect(dialogUpdate).not.toHaveBeenCalled();
    expect(m.recordAudit).not.toHaveBeenCalled();
    expect(m.notifyDialogAssigned).not.toHaveBeenCalled();
  });

  it('снятие ответственного с ничьего диалога — тоже повтор (null → null)', async () => {
    await expect(
      assignDialog(prisma, session, { dialogId: 'd1', assigneeId: null })
    ).resolves.toEqual({ ok: true, changed: false });
    // Назначаемого нет — проверять некого, запрос не делается.
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(dialogUpdate).not.toHaveBeenCalled();
  });

  it('успешное назначение: отметки «кто и когда», аудит с содержимым after, уведомление новому', async () => {
    dialogFindUnique.mockResolvedValueOnce({ ...own, assigneeId: 'u9' });
    const r = await assignDialog(prisma, session, { dialogId: 'd1', assigneeId: 'u2' });
    expect(r).toEqual({ ok: true, changed: true });

    expect(dialogUpdate).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { assigneeId: 'u2', assignedAt: expect.any(Date), assignedById: 'me' },
    });
    // Урок этапа 2: у аудита проверяем именно содержимое `after` — в нём
    // должен остаться и ПРЕЖНИЙ ответственный, иначе «у кого забрали» потом
    // не восстановить.
    expect(m.recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'dialog_assignee_changed',
      entity: 'messenger_dialog',
      entityId: 'd1',
      userId: 'me',
      after: { assigneeId: 'u2', previousAssigneeId: 'u9' },
    });
    expect(m.notifyDialogAssigned).toHaveBeenCalledWith(prisma, {
      assigneeId: 'u2',
      dialogId: 'd1',
    });
  });

  it('назначение самому себе уведомления не шлёт: человек только что сам нажал кнопку', async () => {
    const r = await assignDialog(prisma, session, { dialogId: 'd1', assigneeId: 'me' });
    expect(r).toEqual({ ok: true, changed: true });
    expect(m.recordAudit).toHaveBeenCalledTimes(1);
    expect(m.notifyDialogAssigned).not.toHaveBeenCalled();
  });

  it('снятие ответственного чистит отметки и никого не уведомляет', async () => {
    dialogFindUnique.mockResolvedValueOnce({ ...own, assigneeId: 'u2' });
    const r = await assignDialog(prisma, session, { dialogId: 'd1', assigneeId: null });
    expect(r).toEqual({ ok: true, changed: true });
    expect(dialogUpdate).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { assigneeId: null, assignedAt: null, assignedById: null },
    });
    expect(m.recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ after: { assigneeId: null, previousAssigneeId: 'u2' } })
    );
    expect(m.notifyDialogAssigned).not.toHaveBeenCalled();
  });

  it('сбой уведомления не отменяет назначение (best-effort)', async () => {
    m.notifyDialogAssigned.mockRejectedValueOnce(new Error('smtp down'));
    await expect(
      assignDialog(prisma, session, { dialogId: 'd1', assigneeId: 'u2' })
    ).resolves.toEqual({ ok: true, changed: true });
    expect(dialogUpdate).toHaveBeenCalledOnce();
  });
});

describe('takeDialog («Взять себе»)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogFindUnique.mockResolvedValue(own);
    dialogUpdate.mockResolvedValue({});
    userFindFirst.mockResolvedValue({ id: 'me' });
  });

  it('делегирует общему пути с собой в роли назначаемого', async () => {
    const r = await takeDialog(prisma, session, { dialogId: 'd1' });
    expect(r).toEqual({ ok: true, changed: true });
    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'me' }) })
    );
    expect(dialogUpdate).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { assigneeId: 'me', assignedAt: expect.any(Date), assignedById: 'me' },
    });
    expect(m.notifyDialogAssigned).not.toHaveBeenCalled();
  });

  it('чужой диалог «взять себе» нельзя — тот же not_found', async () => {
    dialogFindUnique.mockResolvedValueOnce({ ...own, companyId: 'other' });
    await expect(takeDialog(prisma, session, { dialogId: 'd1' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('назначение на НИЧЕЙ диалог забирает его в компанию (У-206)', () => {
  /** Ничей диалог из общей очереди: его видят сотрудники всех компаний. */
  const orphan = { id: 'd9', companyId: null, assigneeId: null };

  beforeEach(() => {
    vi.clearAllMocks();
    dialogFindUnique.mockResolvedValue(orphan);
    dialogUpdate.mockResolvedValue({});
    dialogUpdateMany.mockResolvedValue({ count: 1 });
    userFindFirst.mockResolvedValue({ id: 'u2' });
    m.notifyDialogAssigned.mockResolvedValue({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 1,
    });
  });

  it('взял ничей диалог — он стал диалогом моей компании, с записью в аудит', async () => {
    // Иначе общая очередь показывала бы сотрудникам ДРУГИХ компаний имя и
    // рабочую почту ответственного, а любой из них мог бы переназначить
    // чужой диалог на себя.
    await expect(
      assignDialog(prisma, session, { dialogId: 'd9', assigneeId: 'u2' })
    ).resolves.toEqual({ ok: true, changed: true });

    expect(dialogUpdateMany).toHaveBeenCalledWith({
      // Условие в `where`: если компанию за это время проставил кто-то
      // другой, его решение не перетираем.
      where: { id: 'd9', companyId: null },
      data: { companyId: 'c1' },
    });
    expect(m.recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'messenger_dialog_bound',
        entityId: 'd9',
        after: { companyId: 'c1', reason: 'assign' },
      })
    );
  });

  it('компанию успел проставить другой — аудит привязки не пишем', async () => {
    dialogUpdateMany.mockResolvedValue({ count: 0 });
    await assignDialog(prisma, session, { dialogId: 'd9', assigneeId: 'u2' });
    const actions = m.recordAudit.mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(actions).not.toContain('messenger_dialog_bound');
    // Само назначение при этом состоялось.
    expect(actions).toContain('dialog_assignee_changed');
  });

  it('СНЯТИЕ ответственного ничей диалог в компанию не забирает', async () => {
    // Снять ответственного — не значит «взять диалог себе»: диалог должен
    // остаться в общей очереди.
    dialogFindUnique.mockResolvedValue({ ...orphan, assigneeId: 'u2' });
    await assignDialog(prisma, session, { dialogId: 'd9', assigneeId: null });
    expect(dialogUpdateMany).not.toHaveBeenCalled();
  });

  it('диалог уже чьей-то компании второй раз не привязывается', async () => {
    dialogFindUnique.mockResolvedValue({ id: 'd1', companyId: 'c1', assigneeId: null });
    await assignDialog(prisma, session, { dialogId: 'd1', assigneeId: 'u2' });
    expect(dialogUpdateMany).not.toHaveBeenCalled();
  });
});

describe('listAssignableStaff', () => {
  beforeEach(() => vi.clearAllMocks());

  it('сессия без компании → пустой список, база не спрашивается', async () => {
    await expect(listAssignableStaff(prisma, { ...session, companyId: null })).resolves.toEqual([]);
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('только действующий контур ЦО своей компании, устойчивый порядок', async () => {
    userFindMany.mockResolvedValueOnce([]);
    await listAssignableStaff(prisma, session);
    expect(userFindMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', role: { in: ['manager', 'leader'] }, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  });

  it('пустое имя заменяется почтой — иначе сотрудника нельзя было бы выбрать', async () => {
    userFindMany.mockResolvedValueOnce([
      { id: 'u1', name: 'Мария', email: 'm@x.ru' },
      { id: 'u2', name: '   ', email: 'blank@x.ru' },
      { id: 'u3', name: null, email: 'null@x.ru' },
    ]);
    await expect(listAssignableStaff(prisma, session)).resolves.toEqual([
      { id: 'u1', name: 'Мария' },
      { id: 'u2', name: 'blank@x.ru' },
      { id: 'u3', name: 'null@x.ru' },
    ]);
  });
});

describe('claimDialogOnFirstReply (правило первого ответившего)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('условие «ответственного ещё нет» стоит в where, а не в коде', async () => {
    dialogUpdateMany.mockResolvedValueOnce({ count: 1 });
    await expect(claimDialogOnFirstReply(prisma, session, 'd1')).resolves.toBe(true);
    expect(dialogUpdateMany).toHaveBeenCalledWith({
      where: { id: 'd1', assigneeId: null },
      data: { assigneeId: 'me', assignedAt: expect.any(Date), assignedById: 'me' },
    });
    expect(m.recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'dialog_assignee_changed',
      entity: 'messenger_dialog',
      entityId: 'd1',
      userId: 'me',
      after: { assigneeId: 'me', previousAssigneeId: null, reason: 'first_reply' },
    });
  });

  it('за это время назначил кто-то другой (count 0) → false и НИ строки аудита', async () => {
    dialogUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(claimDialogOnFirstReply(prisma, session, 'd1')).resolves.toBe(false);
    expect(m.recordAudit).not.toHaveBeenCalled();
  });
});
