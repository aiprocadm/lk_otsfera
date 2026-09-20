import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess, isMessengerAvailable } = vi.hoisted(() => ({
  recordPiiAccess: vi.fn(),
  isMessengerAvailable: vi.fn(),
}));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));
vi.mock('@/lib/services/messengers/availability', () => ({
  isMessengerAvailable,
}));

import { getDialog, markDialogRead } from '@/lib/services/messengers/get';

/**
 * Карточка диалога (спека 2026-09-12 §5.2): чужой и несуществующий диалог
 * неразличимы снаружи, лента в хронологическом порядке, имена авторов одним
 * запросом, последнее входящее — для «Создать лид» / «Задача».
 */
const dialogFindUnique = vi.fn();
const dialogUpdateMany = vi.fn();
const userFindMany = vi.fn();
// Пороги подсветки просрочки (У-207) карточка читает у компании.
const companyFindUnique = vi.fn().mockResolvedValue(null);
const prisma = {
  messengerDialog: { findUnique: dialogFindUnique, updateMany: dialogUpdateMany },
  user: { findMany: userFindMany },
  company: { findUnique: companyFindUnique },
} as unknown as PrismaClient;
const session = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;

const t = (n: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, n));

const baseRow = {
  id: 'd1',
  channel: 'telegram',
  peerRef: 'chat-1',
  peerDisplay: 'ivan',
  companyId: 'c1',
  status: 'open',
  waitingSince: null,
  assigneeId: null,
  assignee: null,
  unreadCount: 1,
  organization: { id: 'o1', name: 'Ромашка' },
  contact: { id: 'k1', name: 'Иван' },
  user: { id: 'u1', name: 'Иван П.', email: 'i@t.test' },
  _count: { messages: 3 },
  // Выборка от новых к старым.
  messages: [
    {
      id: 'm3',
      direction: 'out',
      body: 'ответ',
      createdAt: t(3),
      deliveryStatus: 'failed',
      authorId: 'mgr-1',
      inboundMessageId: null,
    },
    {
      id: 'm2',
      direction: 'in',
      body: 'вопрос',
      createdAt: t(2),
      deliveryStatus: 'sent',
      authorId: null,
      inboundMessageId: 'im-2',
    },
    {
      id: 'm1',
      direction: 'out',
      body: 'начало',
      createdAt: t(1),
      deliveryStatus: 'sent',
      authorId: 'ghost',
      inboundMessageId: null,
    },
  ],
};

describe('getDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMessengerAvailable.mockReturnValue(true);
    userFindMany.mockResolvedValue([{ id: 'mgr-1', name: '  Мария ', email: 'm@t.test' }]);
  });

  it('нет диалога → not_found; чужая компания → тоже not_found, ПДн не пишется', async () => {
    dialogFindUnique.mockResolvedValueOnce(null);
    await expect(getDialog(prisma, session, 'x')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    dialogFindUnique.mockResolvedValueOnce({ ...baseRow, companyId: 'other' });
    await expect(getDialog(prisma, session, 'd1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('собирает карточку: лента по порядку, авторы, последнее входящее, скрытые', async () => {
    dialogFindUnique.mockResolvedValueOnce(baseRow);
    const r = await getDialog(prisma, session, 'd1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dialog).toMatchObject({
      id: 'd1',
      channel: 'telegram',
      channelAvailable: true,
      peerLabel: 'Иван',
      peerRef: 'chat-1',
      status: 'open',
      assignee: null,
      overdue: 'none',
      unreadCount: 1,
      bound: true,
      organization: { id: 'o1', name: 'Ромашка' },
      contact: { id: 'k1', name: 'Иван' },
      user: { id: 'u1', name: 'Иван П.' },
      hiddenCount: 0,
      lastInbound: { inboundMessageId: 'im-2', body: 'вопрос' },
    });
    expect(r.dialog.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(r.dialog.messages.map((m) => m.authorName)).toEqual([null, null, 'Мария']);
    expect(r.dialog.messages[2]).toMatchObject({ direction: 'out', deliveryStatus: 'failed' });
    expect(userFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['mgr-1', 'ghost'] } },
      select: { id: true, name: true, email: true },
    });
    expect(isMessengerAvailable).toHaveBeenCalledWith('telegram');
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session,
      context: 'messengers_view',
      subjectIds: ['d1'],
    });
  });

  it('автор без имени подписывается почтой; ничей диалог без сообщений — без запроса авторов', async () => {
    userFindMany.mockResolvedValueOnce([{ id: 'mgr-1', name: null, email: 'm@t.test' }]);
    dialogFindUnique.mockResolvedValueOnce({
      ...baseRow,
      messages: [baseRow.messages[0]],
      _count: { messages: 5 },
    });
    const r1 = await getDialog(prisma, session, 'd1');
    if (!r1.ok) throw new Error('unexpected');
    expect(r1.dialog.messages[0]?.authorName).toBe('m@t.test');
    expect(r1.dialog.hiddenCount).toBe(4);
    expect(r1.dialog.lastInbound).toBeNull();

    userFindMany.mockClear();
    isMessengerAvailable.mockReturnValue(false);
    dialogFindUnique.mockResolvedValueOnce({
      ...baseRow,
      companyId: null,
      organization: null,
      contact: null,
      user: null,
      messages: [],
      _count: { messages: 0 },
    });
    const r2 = await getDialog(prisma, session, 'd1');
    if (!r2.ok) throw new Error('unexpected');
    expect(r2.dialog).toMatchObject({
      bound: false,
      channelAvailable: false,
      peerLabel: 'ivan',
      user: null,
      messages: [],
      hiddenCount: 0,
    });
    expect(userFindMany).not.toHaveBeenCalled();
  });
});

describe('getDialog — ответственный, файл и пороги', () => {
  // Свой сброс: общий стоит внутри соседнего describe, и без него счётчик
  // вызовов считает чужие походы в базу.
  beforeEach(() => {
    vi.clearAllMocks();
    isMessengerAvailable.mockReturnValue(true);
    userFindMany.mockResolvedValue([]);
    companyFindUnique.mockResolvedValue(null);
  });

  it('ответственный есть — подписан именем', async () => {
    dialogFindUnique.mockResolvedValue({
      ...baseRow,
      assigneeId: 'mgr-1',
      assignee: { id: 'mgr-1', name: '  Мария Смирнова  ', email: 'm@t.test' },
    });

    const res = await getDialog(prisma, session, 'd1');
    if (!res.ok) throw new Error('ожидался ok');

    // Пробелы по краям срезаются: в списке ответственных они дают «дыру».
    expect(res.dialog.assignee).toEqual({ id: 'mgr-1', name: 'Мария Смирнова' });
  });

  it('имени у ответственного нет — подписываем почтой, а не пустотой', async () => {
    dialogFindUnique.mockResolvedValue({
      ...baseRow,
      assigneeId: 'mgr-2',
      assignee: { id: 'mgr-2', name: '   ', email: 'm2@t.test' },
    });

    const res = await getDialog(prisma, session, 'd1');
    if (!res.ok) throw new Error('ожидался ok');

    expect(res.dialog.assignee).toEqual({ id: 'mgr-2', name: 'm2@t.test' });
  });

  it('файл в сообщении доезжает вместе с вердиктом антивируса', async () => {
    dialogFindUnique.mockResolvedValue({
      ...baseRow,
      _count: { messages: 1 },
      messages: [
        {
          id: 'm1',
          direction: 'in',
          body: 'вот счёт',
          createdAt: t(1),
          deliveryStatus: 'sent',
          authorId: null,
          inboundMessageId: null,
          attachmentName: 'счёт.pdf',
          attachmentSize: 2048,
          scanStatus: 'clean',
        },
      ],
    });

    const res = await getDialog(prisma, session, 'd1');
    if (!res.ok) throw new Error('ожидался ok');

    // Без вердикта экран не отличил бы проверенный файл от заражённого.
    expect(res.dialog.messages[0]?.attachment).toEqual({
      name: 'счёт.pdf',
      size: 2048,
      scanStatus: 'clean',
    });
  });

  it('пороги подсветки берутся у компании, а не из умолчаний схемы', async () => {
    companyFindUnique.mockResolvedValue({ slaResponseHours: 1, slaWarningHours: 1 });
    dialogFindUnique.mockResolvedValue(baseRow);

    await getDialog(prisma, session, 'd1');

    expect(companyFindUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      select: { slaResponseHours: true, slaWarningHours: true },
    });
  });

  it('у роли нет компании — за порогами не ходим вовсе', async () => {
    dialogFindUnique.mockResolvedValue({ ...baseRow, companyId: null });

    await getDialog(prisma, { ...session, companyId: null } as typeof session, 'd1');

    expect(companyFindUnique).not.toHaveBeenCalled();
  });
});

describe('markDialogRead', () => {
  it('обнуляет непрочитанное только в скоупе и только когда есть что обнулять', async () => {
    dialogUpdateMany.mockResolvedValue({ count: 1 });
    await markDialogRead(prisma, session, 'd1');
    expect(dialogUpdateMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: 'd1', unreadCount: { gt: 0 } },
          { OR: [{ companyId: 'c1' }, { companyId: null }] },
        ],
      },
      data: { unreadCount: 0 },
    });
  });
});
