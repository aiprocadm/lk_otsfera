import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dispatchToRecipient } = vi.hoisted(() => ({ dispatchToRecipient: vi.fn() }));
vi.mock('@/lib/notifications/channels/dispatch', () => ({ dispatchToRecipient }));

import { notifyOrderAssigned } from '@/lib/notifications/manager';
import { notificationRoute } from '@/lib/notifications/routes';

/**
 * «Вам передан заказ» (`У-283`, ТЗ 13.10.2026): адресат один — новый
 * ответственный, действующий сотрудник контура ЦО; себе (взял сам) не шлём;
 * ссылка ведёт в карточку заказа своего кабинета.
 */
function makeDb(recipients: unknown[]) {
  const userFindMany = vi.fn().mockResolvedValue(recipients);
  const notificationCreate = vi.fn().mockResolvedValue({ id: 'n1' });
  const notificationFindFirst = vi.fn().mockResolvedValue(null);
  const notificationUpdate = vi.fn().mockResolvedValue({ id: 'n-dup' });
  const notificationRuleFindMany = vi.fn().mockResolvedValue([]);
  return {
    db: {
      user: { findMany: userFindMany },
      notification: {
        create: notificationCreate,
        findFirst: notificationFindFirst,
        update: notificationUpdate,
      },
      notificationRule: { findMany: notificationRuleFindMany },
    } as never,
    userFindMany,
    notificationCreate,
  };
}

const INPUT = {
  assigneeId: 'u2',
  orderId: 'ord-1',
  orderTitle: 'Обучение по ОТ',
  actorUserId: 'u1',
};
const MARIA = { id: 'u2', email: 'u2@x.ru', name: 'Мария', role: 'manager' };

describe('notifyOrderAssigned (У-283)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchToRecipient.mockResolvedValue({
      mode: 'inline',
      results: { email: { status: 'sent' } },
    });
  });

  it('новому ответственному — запись «Вам передан заказ» с id заказа и письмо', async () => {
    const { db, notificationCreate, userFindMany } = makeDb([MARIA]);
    await expect(notifyOrderAssigned(db, INPUT)).resolves.toEqual({
      recipientsNotified: 1,
      emailsSent: 1,
      emailsSkipped: 0,
    });
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u2', role: { in: ['manager', 'leader'] }, isActive: true },
      })
    );
    const data = notificationCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      userId: 'u2',
      type: 'order_assigned',
      title: 'Вам передан заказ',
      entityId: 'ord-1',
    });
    expect(data.body).toContain('«Обучение по ОТ»');
    expect(data.meta).toEqual({ orderId: 'ord-1' });
  });

  it('взял сам (актор = новый ответственный) — ничего не шлём', async () => {
    const { db, userFindMany, notificationCreate } = makeDb([MARIA]);
    await expect(notifyOrderAssigned(db, { ...INPUT, actorUserId: 'u2' })).resolves.toEqual({
      recipientsNotified: 0,
      emailsSent: 0,
      emailsSkipped: 0,
    });
    expect(userFindMany).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('уволенный или вне контура — ноль уведомлений', async () => {
    const { db, notificationCreate } = makeDb([]);
    expect((await notifyOrderAssigned(db, INPUT)).recipientsNotified).toBe(0);
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('письмо не ушло — запись есть, письмо посчитано пропущенным', async () => {
    dispatchToRecipient.mockResolvedValue({
      mode: 'inline',
      results: { email: { status: 'skipped' } },
    });
    const { db } = makeDb([MARIA]);
    expect(await notifyOrderAssigned(db, INPUT)).toEqual({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 1,
    });
  });

  it('ссылка уведомления ведёт в карточку заказа кабинета получателя', () => {
    expect(notificationRoute('order_assigned', { orderId: 'ord-1' }, 'manager')).toBe(
      '/manager/orders/ord-1'
    );
    expect(notificationRoute('order_assigned', { orderId: 'ord-1' }, 'leader')).toBe(
      '/leader/orders/ord-1'
    );
  });
});
