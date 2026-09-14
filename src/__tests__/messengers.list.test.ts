import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { countUnreadDialogs, listDialogs, peerLabelOf } from '@/lib/services/messengers/list';

/**
 * Список диалогов (спека 2026-09-12 §5.1): фильтры и пагинация, имя
 * собеседника по убыванию надёжности источника, журнал ПДн. Скоуп проверяется
 * интеграционно (`security.idor-messengers.integration`).
 */
const findMany = vi.fn();
const count = vi.fn();
const aggregate = vi.fn();
// Пороги подсветки просрочки (У-207) читаются у компании; null — фолбэк на
// умолчания схемы (24 часа на ответ, 4 до предупреждения).
const companyFindUnique = vi.fn();
const prisma = {
  messengerDialog: { findMany, count, aggregate },
  company: { findUnique: companyFindUnique },
} as unknown as PrismaClient;
const session = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;

const row = {
  id: 'd1',
  channel: 'telegram',
  peerRef: 'chat-1',
  peerDisplay: 'ivan',
  companyId: 'c1',
  status: 'open',
  waitingSince: null,
  assigneeId: null,
  assignee: null,
  unreadCount: 2,
  lastMessageAt: new Date('2026-09-10T10:00:00Z'),
  lastMessagePreview: 'привет',
  lastMessageDirection: 'in',
  organization: { id: 'o1', name: 'Ромашка' },
  contact: null,
  user: null,
};

describe('listDialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([row]);
    count.mockResolvedValue(1);
    companyFindUnique.mockResolvedValue(null);
  });

  it('без фильтров: скоуп + пустой extra, первая страница по 25, сортировка по времени', async () => {
    const r = await listDialogs(prisma, session);
    expect(r.total).toBe(1);
    expect(r.items).toEqual([
      {
        id: 'd1',
        channel: 'telegram',
        peerLabel: 'ivan',
        organization: { id: 'o1', name: 'Ромашка' },
        status: 'open',
        assignee: null,
        overdue: 'none',
        unreadCount: 2,
        lastMessageAt: row.lastMessageAt,
        lastMessagePreview: 'привет',
        lastMessageDirection: 'in',
        bound: true,
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ OR: [{ companyId: 'c1' }, { companyId: null }] }, {}] },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 25,
      })
    );
    expect(count).toHaveBeenCalledWith({
      where: { AND: [{ OR: [{ companyId: 'c1' }, { companyId: null }] }, {}] },
    });
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session,
      context: 'messengers_list',
      subjectIds: ['d1'],
    });
  });

  it('фильтры канала и состояния попадают в where; страница и размер ограничены', async () => {
    await listDialogs(prisma, session, {
      channel: 'max',
      status: 'closed',
      page: 3,
      pageSize: 500,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [expect.anything(), { channel: 'max', status: 'closed' }],
        }),
        skip: 200,
        take: 100,
      })
    );
    await listDialogs(prisma, session, { page: 0, pageSize: 0 });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0, take: 1 }));
  });

  it('фильтр «мои» ищет по ответственному, «без ответственного» — по пустому полю (У-206)', async () => {
    await listDialogs(prisma, session, { assignee: 'mine' });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [expect.anything(), { assigneeId: 'm1' }],
        }),
      })
    );
    await listDialogs(prisma, session, { assignee: 'unassigned' });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: [expect.anything(), { assigneeId: null }] }),
      })
    );
    // «Все» — это отсутствие ограничения, а не третье значение в запросе.
    await listDialogs(prisma, session, { assignee: 'all' });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: [expect.anything(), {}] }),
      })
    );
  });

  it('просрочка считается по порогам компании и только в статусе «ждёт ответа» (У-207)', async () => {
    companyFindUnique.mockResolvedValue({ slaResponseHours: 5, slaWarningHours: 2 });
    const longAgo = new Date(Date.now() - 6 * 3_600_000);
    const recently = new Date(Date.now() - 3 * 3_600_000);

    findMany.mockResolvedValue([
      { ...row, id: 'overdue', status: 'waiting_staff', waitingSince: longAgo },
      { ...row, id: 'warning', status: 'waiting_staff', waitingSince: recently },
      // Ждём клиента: остаток прошлого ожидания не должен «гореть».
      { ...row, id: 'waiting-client', status: 'waiting_client', waitingSince: longAgo },
    ]);
    const r = await listDialogs(prisma, session);
    expect(r.items.map((i) => i.overdue)).toEqual(['overdue', 'warning', 'none']);
  });

  it('имя ответственного берётся из связи, пустое — заменяется почтой', async () => {
    findMany.mockResolvedValue([
      { ...row, assigneeId: 'u9', assignee: { id: 'u9', name: '  ', email: 'm@t.test' } },
    ]);
    const r = await listDialogs(prisma, session);
    expect(r.items[0]?.assignee).toEqual({ id: 'u9', name: 'm@t.test' });
  });

  it('ничей диалог помечен bound:false', async () => {
    findMany.mockResolvedValue([{ ...row, companyId: null, organization: null }]);
    const r = await listDialogs(prisma, session);
    expect(r.items[0]).toMatchObject({ bound: false, organization: null });
  });
});

describe('peerLabelOf — имя собеседника по убыванию надёжности', () => {
  const base = { peerRef: 'chat-1', peerDisplay: 'ник', contact: null, user: null };

  it('контакт → пользователь (имя, затем почта) → имя из мессенджера → адрес', () => {
    expect(peerLabelOf({ ...base, contact: { name: '  Иван Петров ' } })).toBe('Иван Петров');
    expect(
      peerLabelOf({ ...base, contact: { name: '  ' }, user: { name: 'Пётр', email: 'p@t.test' } })
    ).toBe('Пётр');
    expect(peerLabelOf({ ...base, user: { name: null, email: 'p@t.test' } })).toBe('p@t.test');
    expect(peerLabelOf({ ...base, user: { name: '   ', email: 'p@t.test' } })).toBe('p@t.test');
    expect(peerLabelOf(base)).toBe('ник');
    expect(peerLabelOf({ ...base, peerDisplay: '  ' })).toBe('chat-1');
    expect(peerLabelOf({ ...base, peerDisplay: null })).toBe('chat-1');
  });
});

describe('countUnreadDialogs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('суммирует непрочитанные НЕЗАКРЫТЫХ диалогов скоупа; пустая сумма → 0', async () => {
    aggregate.mockResolvedValueOnce({ _sum: { unreadCount: 7 } });
    await expect(countUnreadDialogs(prisma, session)).resolves.toBe(7);
    expect(aggregate).toHaveBeenCalledWith({
      where: {
        AND: [
          { OR: [{ companyId: 'c1' }, { companyId: null }] },
          { status: { not: 'closed' }, unreadCount: { gt: 0 } },
        ],
      },
      _sum: { unreadCount: true },
    });
    aggregate.mockResolvedValueOnce({ _sum: { unreadCount: null } });
    await expect(countUnreadDialogs(prisma, session)).resolves.toBe(0);
  });
});
