import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dispatchToRecipient } = vi.hoisted(() => ({ dispatchToRecipient: vi.fn() }));
vi.mock('@/lib/notifications/channels/dispatch', () => ({ dispatchToRecipient }));

import { notifyDialogAssigned, notifyManagersMessengerMessage } from '@/lib/notifications/manager';

/**
 * «Вас назначили ответственным за диалог» (`У-206`): адресат один, он обязан
 * быть действующим сотрудником контура ЦО, а ссылка — вести прямо в
 * переписку, иначе человек будет искать её руками.
 */
function makeDb(recipients: unknown[]) {
  const userFindMany = vi.fn().mockResolvedValue(recipients);
  const notificationCreate = vi.fn().mockResolvedValue({ id: 'n1' });
  // Единая точка `recordNotification` (`У-231`): повтор ищется до создания.
  const notificationFindFirst = vi.fn().mockResolvedValue(null);
  const notificationUpdate = vi.fn().mockResolvedValue({ id: 'n-dup' });
  // Правил маршрутизации в этой базе нет — `allowedChannels` деградирует к
  // «доставлять по умолчанию», как и в бою на чистой таблице.
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
    notificationFindFirst,
    notificationUpdate,
  };
}

const INPUT = { assigneeId: 'u2', dialogId: 'd1' };
// Роль получателя обязательна: по ней таблица маршрутов строит ссылку (`Р-Э5-7`).
const MARIA = { id: 'u2', email: 'u2@x.ru', name: 'Мария', role: 'manager' };

describe('notifyDialogAssigned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchToRecipient.mockResolvedValue({
      mode: 'inline',
      results: { email: { status: 'sent' } },
    });
  });

  it('уволенный или сотрудник вне контура ЦО получателем не становится — ноль уведомлений', async () => {
    const { db, userFindMany, notificationCreate } = makeDb([]);
    await expect(notifyDialogAssigned(db, INPUT)).resolves.toEqual({
      recipientsNotified: 0,
      emailsSent: 0,
      emailsSkipped: 0,
    });
    // Обе отсечки — в одном запросе: роль и «действует».
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u2', role: { in: ['manager', 'leader'] }, isActive: true },
      })
    );
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(dispatchToRecipient).not.toHaveBeenCalled();
  });

  it('тип dialog_assigned: в записи кабинета — идентификатор диалога, в доставке — ссылка в него', async () => {
    const { db, notificationCreate } = makeDb([MARIA]);

    const r = await notifyDialogAssigned(db, INPUT);
    expect(r).toEqual({ recipientsNotified: 1, emailsSent: 1, emailsSkipped: 0 });

    expect(notificationCreate).toHaveBeenCalledOnce();
    const data = notificationCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      userId: 'u2',
      type: 'dialog_assigned',
      title: 'Вас назначили ответственным за диалог',
      // `У-231`: ключ дедупа — диалог.
      entityId: 'd1',
    });
    // `Р-Э5-7`: в строке только идентификатор — адрес считается по роли на чтении.
    expect(data.meta).toEqual({ dialogId: 'd1' });

    const [recipient, payload, opts] = dispatchToRecipient.mock.calls[0]!;
    expect(recipient).toMatchObject({ id: 'u2' });
    expect(payload).toMatchObject({
      type: 'dialog_assigned',
      url: expect.stringContaining('/manager/messengers/d1'),
      email: {
        template: 'notification',
        props: { url: expect.stringContaining('/manager/messengers/d1') },
      },
    });
    // Ключ идемпотентности — id только что созданной записи кабинета.
    expect(opts).toMatchObject({ dedupKey: 'n1' });
  });

  it('ссылка ведёт именно в этот диалог, а не в общий список', async () => {
    const { db } = makeDb([MARIA]);
    await notifyDialogAssigned(db, { assigneeId: 'u2', dialogId: 'd-777' });
    const url = dispatchToRecipient.mock.calls[0]![1].url as string;
    expect(url.endsWith('/manager/messengers/d-777')).toBe(true);
  });

  it('руководитель-ответственный: ссылка тоже в кабинет менеджера — «Мессенджеры» есть только там (У-232, играющий тренер)', async () => {
    const { db } = makeDb([{ ...MARIA, role: 'leader' }]);
    await notifyDialogAssigned(db, INPUT);
    const payload = dispatchToRecipient.mock.calls[0]![1];
    expect(payload.url).toMatch(/\/manager\/messengers\/d1$/);
    expect(payload.email.props.url).toMatch(/\/manager\/messengers\/d1$/);
  });

  it('повторное назначение в окне (У-231): строка обновляется, письмо не дублируется', async () => {
    const { db, notificationCreate, notificationFindFirst, notificationUpdate } = makeDb([MARIA]);
    notificationFindFirst.mockResolvedValue({ id: 'n-old' });
    await expect(notifyDialogAssigned(db, INPUT)).resolves.toEqual({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 1,
    });
    expect(notificationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u2', type: 'dialog_assigned', entityId: 'd1' }),
      })
    );
    expect(notificationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'n-old' },
        data: expect.objectContaining({ dedupCount: { increment: 1 }, isRead: false }),
      })
    );
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(dispatchToRecipient).not.toHaveBeenCalled();
  });

  it('канал без почты — письмо считается пропущенным, уведомление в кабинете остаётся', async () => {
    dispatchToRecipient.mockResolvedValueOnce({
      mode: 'inline',
      results: { email: { status: 'skipped' } },
    });
    const { db } = makeDb([{ ...MARIA, email: null, name: 'Без почты' }]);
    await expect(notifyDialogAssigned(db, INPUT)).resolves.toEqual({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 1,
    });
  });

  it('очередь доставки: письмо посчитано как поставленное, а не как отправленное', async () => {
    dispatchToRecipient.mockResolvedValueOnce({ mode: 'queued', channels: ['email'] });
    const { db } = makeDb([MARIA]);
    await expect(notifyDialogAssigned(db, INPUT)).resolves.toEqual({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 0,
      emailsQueued: 1,
    });
  });

  it('очередь без канала почты — письмо пропущено', async () => {
    dispatchToRecipient.mockResolvedValueOnce({ mode: 'queued', channels: ['telegram'] });
    const { db } = makeDb([MARIA]);
    await expect(notifyDialogAssigned(db, INPUT)).resolves.toEqual({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 1,
    });
  });
});

describe('таргетинг сообщения диалога: ответственный вместо менеджеров организации', () => {
  /** База, где у организации есть закреплённый менеджер `mgr`. */
  function makeOrgDb(recipients: unknown[]) {
    const userFindMany = vi.fn().mockResolvedValue(recipients);
    const notificationCreate = vi.fn().mockResolvedValue({ id: 'n1' });
    const notificationFindFirst = vi.fn().mockResolvedValue(null);
    return {
      db: {
        organizationManager: { findMany: vi.fn().mockResolvedValue([{ userId: 'mgr' }]) },
        user: { findMany: userFindMany },
        notification: {
          create: notificationCreate,
          findFirst: notificationFindFirst,
          update: vi.fn(),
        },
        notificationRule: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      userFindMany,
      notificationCreate,
      notificationFindFirst,
    };
  }
  const PETR = { id: 'mgr', email: 'm@x.ru', name: 'Пётр', role: 'manager' };

  const MSG = {
    organizationId: 'org1',
    dialogId: 'd1',
    peerLabel: 'Иван',
    channelLabel: 'Telegram',
    excerpt: 'нужен счёт',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dispatchToRecipient.mockResolvedValue({
      mode: 'inline',
      results: { email: { status: 'sent' } },
    });
  });

  it('есть ответственный → адресат только он', async () => {
    const { db, notificationCreate, notificationFindFirst } = makeOrgDb([MARIA]);
    const r = await notifyManagersMessengerMessage(db, { ...MSG, assigneeId: 'u2' });
    expect(r.recipientsNotified).toBe(1);
    expect(notificationCreate.mock.calls[0]![0].data).toMatchObject({
      userId: 'u2',
      type: 'messenger_message',
      entityId: 'd1',
    });
    // Сообщения — `noDedup` в реестре: каждое важно само по себе, повтор не ищется.
    expect(notificationFindFirst).not.toHaveBeenCalled();
  });

  it('ответственный уволен → уведомление откатывается на менеджеров организации', async () => {
    // Ветка ответственного сама отсеивает неактивных и не-ЦО. Если после
    // этого адресата не осталось, молчать нельзя: сообщение клиента не увидел
    // бы никто, и узнали бы о нём только из эскалации SLA — через сутки.
    const { db, userFindMany, notificationCreate } = makeOrgDb([]);
    // Первый запрос — ответственный (уволен, пусто), второй — менеджеры орг.
    userFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([PETR]);
    const r = await notifyManagersMessengerMessage(db, { ...MSG, assigneeId: 'fired' });
    expect(r.recipientsNotified).toBe(1);
    expect(notificationCreate.mock.calls[0]![0].data).toMatchObject({ userId: 'mgr' });
  });

  it('ответственный уволен и организации нет → молчание (уведомлять некого)', async () => {
    const { db, notificationCreate } = makeOrgDb([]);
    const r = await notifyManagersMessengerMessage(db, {
      ...MSG,
      organizationId: null,
      assigneeId: 'fired',
    });
    expect(r).toEqual({ recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 });
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('ответственного нет → прежнее поведение: менеджеры организации', async () => {
    const { db, notificationCreate } = makeOrgDb([PETR]);
    const r = await notifyManagersMessengerMessage(db, { ...MSG, assigneeId: null });
    expect(r.recipientsNotified).toBe(1);
    expect(notificationCreate.mock.calls[0]![0].data).toMatchObject({ userId: 'mgr' });
  });

  it('ни ответственного, ни организации → молчание без запросов к базе', async () => {
    const { db, userFindMany, notificationCreate } = makeOrgDb([]);
    const r = await notifyManagersMessengerMessage(db, {
      ...MSG,
      organizationId: null,
      assigneeId: null,
    });
    expect(r).toEqual({ recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 });
    expect(userFindMany).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
