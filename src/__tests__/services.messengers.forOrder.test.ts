import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { listOrderDialogs, ORDER_DIALOGS_CAP } from '@/lib/services/messengers/forOrder';

/**
 * «Переписка с клиентом» в карточке заказа (`У-210`).
 *
 * У заказа своей переписки нет — она принадлежит человеку и организации.
 * Поэтому проверяем три вещи, каждая из которых уже ломалась в похожих местах:
 * 1) заказ, которому не с кем переписываться, НЕ ходит в базу (иначе `OR: []`
 *    в Prisma даёт молчаливую выборку «всё подряд»);
 * 2) граница компании (`dialogScopeWhere`) остаётся поверх адресных условий —
 *    это последняя дверь, и сокращать её нельзя (CLAUDE.md §4);
 * 3) в журнал ПДн пишется контекст `order_card_dialogs` — чтение переписки
 *    клиента обязано быть видно в журнале (§25.7).
 */
const findMany = vi.fn();
const count = vi.fn();
const prisma = { messengerDialog: { findMany, count } } as unknown as PrismaClient;
const session = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;

/** Скоуп диалогов: своя компания + ничейные (общая очередь). */
const SCOPE = { OR: [{ companyId: 'c1' }, { companyId: null }] };

const row = {
  id: 'd1',
  channel: 'telegram',
  status: 'waiting_staff',
  peerDisplay: 'Иван',
  peerRef: 'tg-1',
  lastMessageAt: new Date('2026-09-14T10:00:00Z'),
  lastMessagePreview: 'привет',
};

describe('listOrderDialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([row]);
    count.mockResolvedValue(1);
  });

  it('заказ без контакта и без организации → пусто, база не спрашивается', async () => {
    const r = await listOrderDialogs(prisma, session, {
      organizationId: null,
      primaryContactId: null,
    });
    expect(r).toEqual({ rows: [], total: 0 });
    // Главное в этой проверке: именно НЕ вызван. Пустой `OR: []` вернул бы
    // чужую переписку, а панель заказа выглядела бы «работающей».
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('только контакт → адресом выборки становится он один', async () => {
    await listOrderDialogs(prisma, session, {
      organizationId: null,
      primaryContactId: 'k1',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [SCOPE, { OR: [{ contactId: 'k1' }] }] },
      })
    );
  });

  it('только организация → выборка по организации', async () => {
    await listOrderDialogs(prisma, session, {
      organizationId: 'o1',
      primaryContactId: null,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [SCOPE, { OR: [{ organizationId: 'o1' }] }] },
      })
    );
  });

  it('контакт и организация: оба адреса под скоупом, свежие сверху, предел панели', async () => {
    await listOrderDialogs(prisma, session, {
      organizationId: 'o1',
      primaryContactId: 'k1',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [SCOPE, { OR: [{ contactId: 'k1' }, { organizationId: 'o1' }] }],
        },
        // Хвост `id` — устойчивый порядок при одинаковом времени (бэкфилл
        // проставляет его пачкой), иначе панель «прыгает» между обновлениями.
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: ORDER_DIALOGS_CAP,
      })
    );
    // Карточка заказа — не раздел переписки: длинный список тут вреден.
    expect(ORDER_DIALOGS_CAP).toBe(5);
  });

  it('сессия без компании не совпадает «со всеми компаниями сразу»', async () => {
    await listOrderDialogs(prisma, { ...session, companyId: null } as SessionPayload, {
      organizationId: 'o1',
      primaryContactId: null,
    });
    // Страховка-часовой: `companyId: undefined` снял бы фильтр целиком.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { OR: [{ companyId: '__no_company__' }, { companyId: null }] },
            { OR: [{ organizationId: 'o1' }] },
          ],
        },
      })
    );
  });

  it('имя собеседника: peerDisplay, а при пустом — адрес; журнал ПДн заполнен', async () => {
    findMany.mockResolvedValue([
      row,
      { ...row, id: 'd2', peerDisplay: '   ', peerRef: '+79990001122' },
      { ...row, id: 'd3', peerDisplay: null, peerRef: 'mx-9', lastMessagePreview: null },
    ]);
    const r = await listOrderDialogs(prisma, session, {
      organizationId: 'o1',
      primaryContactId: 'k1',
    });
    expect(r.rows).toEqual([
      {
        id: 'd1',
        channel: 'telegram',
        status: 'waiting_staff',
        peerLabel: 'Иван',
        lastMessageAt: row.lastMessageAt,
        lastMessagePreview: 'привет',
      },
      // Пробелы вместо имени — это «имени нет», а не имя из пробелов.
      expect.objectContaining({ id: 'd2', peerLabel: '+79990001122' }),
      expect.objectContaining({ id: 'd3', peerLabel: 'mx-9', lastMessagePreview: null }),
    ]);
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session,
      context: 'order_card_dialogs',
      subjectIds: ['d1', 'd2', 'd3'],
    });
  });

  it('счётчик считает по ТОМУ ЖЕ условию, что и выборка, — иначе «из N» соврёт', async () => {
    findMany.mockResolvedValue([row]);
    count.mockResolvedValue(12);
    const r = await listOrderDialogs(prisma, session, {
      organizationId: 'o1',
      primaryContactId: 'k1',
    });

    // Панель показывает несколько свежих строк. Без общего числа человек видел
    // бы пять диалогов и думал, что это вся переписка (молчаливое усечение).
    expect(r.rows).toHaveLength(1);
    expect(r.total).toBe(12);
    const listWhere = findMany.mock.calls[0]![0].where;
    const countWhere = count.mock.calls[0]![0].where;
    expect(countWhere).toEqual(listWhere);
  });

  it('переписки ещё нет: пустой список, но чтение всё равно зафиксировано', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    const r = await listOrderDialogs(prisma, session, {
      organizationId: 'o1',
      primaryContactId: null,
    });
    expect(r).toEqual({ rows: [], total: 0 });
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session,
      context: 'order_card_dialogs',
      subjectIds: [],
    });
  });
});
