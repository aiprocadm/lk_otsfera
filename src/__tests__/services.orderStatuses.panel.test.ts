/**
 * §10 ТЗ v0.5 (этап 2, PR-3) — что показывать кнопками на карточке.
 *
 * Ключевой инвариант: кнопки совпадают с тем, что реально разрешит сервис
 * перехода. Иначе менеджер видел бы «Вернуть» и получал отказ при нажатии.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { getOrderedStatuses, listStatusHistory } = vi.hoisted(() => ({
  getOrderedStatuses: vi.fn(),
  listStatusHistory: vi.fn()
}));
vi.mock('@/lib/services/orderStatuses/definitions', () => ({ getOrderedStatuses }));
vi.mock('@/lib/services/orderStatuses/transitions', () => ({ listStatusHistory }));

import { getOrderStatusPanel } from '@/lib/services/orderStatuses/panel';

const STATUSES = [
  { id: 'd', key: 'draft', label: 'Черновик заявки', sortOrder: 1, isActive: true, isTerminal: false, anchor: null },
  { id: 'a', key: 'accepted', label: 'Принято в работу', sortOrder: 2, isActive: true, isTerminal: false, anchor: null },
  { id: 'p', key: 'paid', label: 'Оплата поступила', sortOrder: 3, isActive: true, isTerminal: false, anchor: 'paid' },
  { id: 'c', key: 'closed', label: 'Заявка закрыта', sortOrder: 6, isActive: true, isTerminal: false, anchor: 'closed' },
  { id: 'x', key: 'cancelled', label: 'Отменена', sortOrder: 7, isActive: true, isTerminal: true, anchor: null },
  { id: 'off', key: 'off', label: 'Выключенный', sortOrder: 8, isActive: false, isTerminal: false, anchor: null }
];

function prismaWith(statusId: string | null) {
  return {
    order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', statusId }) }
  } as unknown as PrismaClient;
}

const sess = (role: string, extra: Partial<SessionPayload> = {}): SessionPayload =>
  ({ sub: 'u1', role, ...extra }) as SessionPayload;

beforeEach(() => {
  getOrderedStatuses.mockReset().mockResolvedValue(STATUSES);
  listStatusHistory.mockReset().mockResolvedValue([]);
});

describe('getOrderStatusPanel', () => {
  it('менеджер: вперёд можно, назад — нет', async () => {
    const panel = await getOrderStatusPanel(prismaWith('a'), sess('manager'), 'o1');
    expect(panel.current?.label).toBe('Принято в работу');
    expect(panel.forward.map((s) => s.label)).toEqual(['Оплата поступила', 'Заявка закрыта']);
    expect(panel.backward).toEqual([]);
    expect(panel.terminal?.label).toBe('Отменена');
  });

  it('руководитель и админ видят возврат назад', async () => {
    const leader = await getOrderStatusPanel(
      prismaWith('p'),
      sess('manager', { managerRole: 'leader' }),
      'o1'
    );
    expect(leader.backward.map((s) => s.label)).toEqual(['Черновик заявки', 'Принято в работу']);

    const admin = await getOrderStatusPanel(prismaWith('p'), sess('admin'), 'o1');
    expect(admin.backward.length).toBe(2);
  });

  it('выключенный статус в кнопки не попадает', async () => {
    const panel = await getOrderStatusPanel(prismaWith('a'), sess('admin'), 'o1');
    expect(panel.forward.some((s) => s.label === 'Выключенный')).toBe(false);
  });

  it('из отмены поднять может только elevated — и на любую стадию', async () => {
    const mgr = await getOrderStatusPanel(prismaWith('x'), sess('manager'), 'o1');
    expect(mgr.forward).toEqual([]);
    expect(mgr.backward).toEqual([]);

    const admin = await getOrderStatusPanel(prismaWith('x'), sess('admin'), 'o1');
    expect(admin.backward.length).toBe(4);
  });

  it('заявка без статуса: вперёд доступны все стадии', async () => {
    const panel = await getOrderStatusPanel(prismaWith(null), sess('manager'), 'o1');
    expect(panel.current).toBeNull();
    expect(panel.forward.length).toBe(4);
    expect(panel.backward).toEqual([]);
  });

  it('клиентские роли кнопок не получают', async () => {
    for (const role of ['organization', 'partner', 'student']) {
      const panel = await getOrderStatusPanel(prismaWith('a'), sess(role), 'o1');
      expect(panel.forward).toEqual([]);
      expect(panel.backward).toEqual([]);
      expect(panel.terminal).toBeNull();
    }
  });

  it('несуществующая заявка не роняет панель', async () => {
    const prisma = { order: { findUnique: vi.fn().mockResolvedValue(null) } } as unknown as PrismaClient;
    const panel = await getOrderStatusPanel(prisma, sess('admin'), 'nope');
    expect(panel.current).toBeNull();
  });

  it('если «Отменена» выключена в справочнике — кнопки отмены нет', async () => {
    getOrderedStatuses.mockResolvedValue(
      STATUSES.map((s) => (s.isTerminal ? { ...s, isActive: false } : s))
    );
    const panel = await getOrderStatusPanel(prismaWith('a'), sess('admin'), 'o1');
    expect(panel.terminal).toBeNull();
  });

  it('автоматические статусы помечены флагом', async () => {
    const panel = await getOrderStatusPanel(prismaWith('a'), sess('admin'), 'o1');
    expect(panel.forward.find((s) => s.label === 'Оплата поступила')?.isAuto).toBe(true);
  });

  it('история разворачивается в плоские строки', async () => {
    listStatusHistory.mockResolvedValue([
      {
        id: 'h1',
        createdAt: new Date('2026-07-01T10:00:00Z'),
        reason: 'клиент отказался',
        from: { id: 'a', label: 'Принято в работу' },
        to: { id: 'x', label: 'Отменена' },
        user: { name: 'Иванов', email: 'i@t.local' }
      },
      {
        id: 'h2',
        createdAt: new Date('2026-07-01T09:00:00Z'),
        reason: null,
        from: null,
        to: { id: 'a', label: 'Принято в работу' },
        user: null
      }
    ]);
    const panel = await getOrderStatusPanel(prismaWith('x'), sess('admin'), 'o1');
    expect(panel.history[0]).toMatchObject({
      fromLabel: 'Принято в работу',
      toLabel: 'Отменена',
      userName: 'Иванов',
      reason: 'клиент отказался'
    });
    expect(panel.history[1]).toMatchObject({ fromLabel: null, userName: null });
  });

  it('если у пользователя нет имени — показывается почта', async () => {
    listStatusHistory.mockResolvedValue([
      {
        id: 'h1',
        createdAt: new Date(),
        reason: null,
        from: null,
        to: { id: 'a', label: 'Принято в работу' },
        user: { name: null, email: 'x@t.local' }
      }
    ]);
    const panel = await getOrderStatusPanel(prismaWith('a'), sess('admin'), 'o1');
    expect(panel.history[0].userName).toBe('x@t.local');
  });
});
