/**
 * Unit tests for src/lib/notifications/core.ts
 *
 * Mocks: prisma (db) + email/send + telegram/client
 * None of these tests need a live Postgres — purely unit.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  notificationCreate,
  userFindUnique,
  sendNotificationEmailMock,
  isTelegramEnabledMock,
  sendTelegramMessageMock,
} = vi.hoisted(() => ({
  notificationCreate: vi.fn(),
  userFindUnique: vi.fn(),
  sendNotificationEmailMock: vi.fn(),
  isTelegramEnabledMock: vi.fn(),
  sendTelegramMessageMock: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    notification: { create: notificationCreate },
    user: { findUnique: userFindUnique },
  },
}));

vi.mock('@/lib/email/send', () => ({
  sendNotificationEmail: sendNotificationEmailMock,
}));

vi.mock('@/lib/telegram/client', () => ({
  isTelegramEnabled: isTelegramEnabledMock,
  sendTelegramMessage: sendTelegramMessageMock,
}));

// ---------------------------------------------------------------------------
// SUT — imported AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  recordNotification,
  deliverNotificationToUser,
  type NotificationDb,
} from '@/lib/notifications/core';
// Import via barrel (src/lib/notifications/index.ts) to ensure coverage instruments it.
// The barrel is a pure re-export module; importing it is sufficient to hit its branch.
import { recordNotification as recordNotificationViaBarrel } from '@/lib/notifications';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.clearAllMocks();
});

const BASE_INPUT = {
  userId: 'u-1',
  organizationId: 'org-1',
  partnerId: null,
  title: 'Test title',
  body: 'Test body',
} as const;

// ---------------------------------------------------------------------------
// recordNotification — единая точка создания (этап 5 PR-3, У-231). Правило
// дедупа целиком — в notifications.dedup.guardrail; здесь — форма записи.
// ---------------------------------------------------------------------------

function fakeDb() {
  const findFirst = vi.fn().mockResolvedValue(null);
  const update = vi.fn();
  return {
    db: {
      notification: { findFirst, create: notificationCreate, update },
    } as unknown as NotificationDb,
    findFirst,
    update,
  };
}

describe('recordNotification', () => {
  it('meta: null → Prisma.JsonNull (сентинел, не plain null); строка и deduped: false', async () => {
    const fakeRow = { id: 'n-1' };
    notificationCreate.mockResolvedValue(fakeRow);
    const { db } = fakeDb();

    const result = await recordNotification(db, {
      ...BASE_INPUT,
      type: 'document_created',
      meta: null,
    });

    expect(notificationCreate).toHaveBeenCalledOnce();
    const callData = notificationCreate.mock.calls[0][0].data;
    expect(callData.meta).not.toBe(null);
    expect(callData.type).toBe('document_created');
    expect(callData.organizationId).toBe('org-1');
    expect(callData.partnerId).toBeNull();
    expect(callData.entityId).toBeNull();
    expect(callData.lastOccurredAt).toBeInstanceOf(Date);
    expect(result).toEqual({ row: fakeRow, deduped: false });
  });

  it('meta-объект уходит как есть, entityId — в строку', async () => {
    notificationCreate.mockResolvedValue({ id: 'n-2' });
    const { db, findFirst } = fakeDb();
    const meta = { key: 'value' };

    await recordNotification(db, { ...BASE_INPUT, type: 'status_changed', meta, entityId: 'o1' });

    const callData = notificationCreate.mock.calls[0][0].data;
    expect(callData.meta).toBe(meta);
    expect(callData.entityId).toBe('o1');
    // С entityId сначала ищется кандидат на дедуп — по получателю, типу и объекту.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u-1', type: 'status_changed', entityId: 'o1' }),
      })
    );
  });

  it('без entityId кандидат не ищется — дедупа нет', async () => {
    notificationCreate.mockResolvedValue({ id: 'n-3' });
    const { db, findFirst } = fakeDb();
    await recordNotification(db, { ...BASE_INPUT, type: 'status_changed' });
    expect(findFirst).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Barrel re-export coverage (notifications/index.ts)
// ---------------------------------------------------------------------------

describe('notifications barrel (index.ts)', () => {
  it('recordNotification imported via barrel is the same function as the named export', async () => {
    expect(recordNotificationViaBarrel).toBe(recordNotification);
  });
});

// ---------------------------------------------------------------------------
// deliverNotificationToUser (D1 — замена triggerNotificationEmail/Telegram)
// ---------------------------------------------------------------------------

describe('deliverNotificationToUser', () => {
  const PAYLOAD = {
    userId: 'u-1',
    title: 'Уведомление',
    body: 'Тело',
    type: 'document_created',
    url: 'https://lk.example.ru/orders/42',
  };

  function mockUser(overrides: Record<string, unknown> = {}) {
    userFindUnique.mockResolvedValue({
      id: 'u-1',
      email: 'partner@test.ru',
      name: 'Тест Пользователь',
      role: 'partner',
      telegramChatId: null,
      maxChatId: null,
      whatsappPhone: null,
      notificationChannels: null,
      ...overrides,
    });
  }

  it('загружает получателя узким канальным select-ом', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser();
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-1' });

    await deliverNotificationToUser(PAYLOAD);

    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: PAYLOAD.userId },
      select: {
        id: true,
        email: true,
        name: true,
        // Этап 5 PR-3 (`Р-Э5-7`): ссылка в письме считается от роли получателя.
        role: true,
        // Этап 5 PR-2 (`У-229`): личные настройки «событие × канал» едут вместе с
        // получателем — доставка сужает веер без второго запроса к базе.
        notificationPreferences: { select: { eventType: true, channels: true } },
        telegramChatId: true,
        maxChatId: true,
        whatsappPhone: true,
        notificationChannels: true,
      },
    });
  });

  it('без url ссылка считается от роли получателя по meta (Р-Э5-7): руководитель → /leader/…', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser({ role: 'leader' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-1' });

    await deliverNotificationToUser({
      userId: 'u-1',
      title: 'Т',
      body: 'Б',
      type: 'comment_from_org',
      meta: { orderId: 'o1' },
    });

    expect(sendNotificationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringMatching(/^https?:\/\/.+\/leader\/orders\/o1$/) })
    );
  });

  it('тот же payload менеджеру → /manager/…; явный url важнее таблицы', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser({ role: 'manager' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-1' });

    await deliverNotificationToUser({
      userId: 'u-1',
      title: 'Т',
      body: 'Б',
      type: 'comment_from_org',
      meta: { orderId: 'o1' },
    });
    expect(sendNotificationEmailMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: expect.stringMatching(/\/manager\/orders\/o1$/) })
    );

    await deliverNotificationToUser({
      userId: 'u-1',
      title: 'Т',
      body: 'Б',
      type: 'comment_from_org',
      meta: { orderId: 'o1' },
      url: 'https://lk.example.ru/custom',
    });
    expect(sendNotificationEmailMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: 'https://lk.example.ru/custom' })
    );
  });

  it('роль без такого раздела и без url → письмо без ссылки', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser({ role: 'admin' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-1' });

    await deliverNotificationToUser({
      userId: 'u-1',
      title: 'Т',
      body: 'Б',
      type: 'task_assigned',
      meta: { taskId: 't1' },
    });
    expect(sendNotificationEmailMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: undefined })
    );
  });

  it('пользователь не найден → пустой результат, каналы не вызываются', async () => {
    userFindUnique.mockResolvedValue(null);

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(results).toEqual({});
    expect(sendNotificationEmailMock).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('шлёт generic-email с recipientName из user.name', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser();
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-1' });

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(sendNotificationEmailMock).toHaveBeenCalledOnce();
    expect(sendNotificationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'partner@test.ru',
        recipientName: 'Тест Пользователь',
        title: PAYLOAD.title,
        body: PAYLOAD.body,
        url: PAYLOAD.url,
      })
    );
    expect(results.email).toEqual({ status: 'sent' });
  });

  it('fallback recipientName «партнёр», когда user.name пуст', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser({ name: null, email: 'anon@test.ru' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-2' });

    // Payload без url: ключ убран (при exactOptionalPropertyTypes «поля нет»
    // выражается удалением ключа), доставка видит тот же payload.url === undefined.
    const { url: _url, ...payloadWithoutUrl } = PAYLOAD;
    void _url;
    await deliverNotificationToUser(payloadWithoutUrl);

    expect(sendNotificationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipientName: 'партнёр' })
    );
  });

  it('выключенный email-пайплайн → канал возвращает skipped (гейт внутри send())', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser();
    sendNotificationEmailMock.mockResolvedValue({ status: 'skipped', reason: 'disabled' });

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(results.email).toEqual({ status: 'skipped', reason: 'disabled' });
  });

  it('Telegram выключен (env) → sendTelegramMessage не вызывается', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser({ telegramChatId: '123456789' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-3' });

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(results.telegram).toBeUndefined();
  });

  it('Telegram включён, чата нет → канал пропущен', async () => {
    isTelegramEnabledMock.mockReturnValue(true);
    mockUser({ telegramChatId: null });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-4' });

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(results.telegram).toBeUndefined();
  });

  it('Telegram включён и привязан → шлёт "title\\n\\nbody" в чат', async () => {
    isTelegramEnabledMock.mockReturnValue(true);
    mockUser({ telegramChatId: '123456789' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-5' });
    sendTelegramMessageMock.mockResolvedValue({ ok: true });

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(sendTelegramMessageMock).toHaveBeenCalledOnce();
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      '123456789',
      `${PAYLOAD.title}\n\n${PAYLOAD.body}`
    );
    expect(results.telegram).toEqual({ status: 'sent' });
  });

  it('channels: ["email"] сужает веер — Telegram не трогается даже при привязке', async () => {
    isTelegramEnabledMock.mockReturnValue(true);
    mockUser({ telegramChatId: '123456789' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-6' });

    const results = await deliverNotificationToUser({ ...PAYLOAD, channels: ['email'] });

    expect(sendNotificationEmailMock).toHaveBeenCalledOnce();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(results.telegram).toBeUndefined();
  });

  it('dedupKey задан, но notif_queue выключен → inline через диспетчер (D5-путь)', async () => {
    // Без FEATURE_NOTIF_QUEUE/REDIS_URL диспетчер деградирует в inline —
    // проверяем, что dedupKey-ветка core.ts возвращает inline-результаты.
    delete process.env.FEATURE_NOTIF_QUEUE;
    delete process.env.REDIS_URL;
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser();
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-7' });

    const results = await deliverNotificationToUser({ ...PAYLOAD, dedupKey: 'notif-xyz' });

    expect(results.email).toEqual({ status: 'sent' });
    expect(sendNotificationEmailMock).toHaveBeenCalledOnce();
  });
});
