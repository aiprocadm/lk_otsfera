/**
 * Уведомления по заявке С САЙТА (этап 3, `У-211`) —
 * `src/lib/services/clientRequests/notify.ts`.
 *
 * У такой заявки нет ни организации, ни партнёра, ни автора: её прислал
 * посторонний человек. До этапа 3 fan-out в этом случае молча не уходил никому.
 * Проверяем третью ветку адресатов (менеджер по умолчанию → весь контур ЦО),
 * свой заголовок уведомления и то, что подателю ничего не шлётся — его нет.
 *
 * Ветки «заявка организации» и «заявка партнёра» живут в
 * `services.clientRequests.notify.test.ts`; здесь они только на контрасте.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createNotification, deliverNotificationToUser, resolveOrgManagerRecipients } = vi.hoisted(
  () => ({
    createNotification: vi.fn(),
    deliverNotificationToUser: vi.fn(),
    resolveOrgManagerRecipients: vi.fn(),
  })
);
vi.mock('@/lib/notifications', () => ({
  createNotification,
  deliverNotificationToUser,
  resolveOrgManagerRecipients,
}));

const { getSettingValue } = vi.hoisted(() => ({ getSettingValue: vi.fn() }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingValue }));

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  log: { warn: logWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import type { ClientRequest } from '@prisma/client';
import { CHANNEL_RECIPIENT_SELECT } from '@/lib/notifications/channels/types';
import {
  notifyManagersClientRequestSubmitted,
  notifySubmitterClientRequestStatus,
} from '@/lib/services/clientRequests/notify';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Заявка с сайта: автора, организации и партнёра нет. */
const websiteRequest = (over: Partial<ClientRequest> = {}): ClientRequest =>
  ({
    id: 'R-site-1',
    source: 'website',
    status: 'submitted',
    submittedByUserId: null,
    partnerId: null,
    organizationId: null,
    companyName: 'ООО Ромашка',
    subject: 'Обучение по охране труда',
    rejectedReason: null,
    ...over,
  }) as ClientRequest;

function db(users: Array<{ id: string }> = [{ id: 'm1' }]) {
  const userFindMany = vi.fn().mockResolvedValue(users);
  const omFindMany = vi.fn().mockResolvedValue([]);
  return {
    prisma: {
      user: { findMany: userFindMany },
      organizationManager: { findMany: omFindMany },
    } as never,
    userFindMany,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createNotification.mockImplementation(async ({ userId }: { userId: string }) => ({
    id: `n-${userId}`,
  }));
  deliverNotificationToUser.mockResolvedValue({});
  resolveOrgManagerRecipients.mockResolvedValue([]);
  getSettingValue.mockResolvedValue(null);
});

// ─── адресаты ─────────────────────────────────────────────────────────────────

describe('заявка с сайта — кому уходит уведомление', () => {
  it('менеджер по умолчанию задан: адресат только он', async () => {
    getSettingValue.mockResolvedValue('  u-default  ');
    const { prisma, userFindMany } = db([{ id: 'u-default' }]);

    await notifyManagersClientRequestSubmitted(prisma, websiteRequest());

    expect(getSettingValue).toHaveBeenCalledWith(prisma, 'site.defaultManagerId');
    expect(userFindMany).toHaveBeenCalledWith({
      where: { id: 'u-default', role: { in: ['manager', 'leader'] }, isActive: true },
      select: CHANNEL_RECIPIENT_SELECT,
    });
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][0].userId).toBe('u-default');
  });

  it('менеджер по умолчанию не задан: адресаты — весь контур ЦО, только активные', async () => {
    const { prisma, userFindMany } = db([{ id: 'm1' }, { id: 'l1' }]);

    await notifyManagersClientRequestSubmitted(prisma, websiteRequest());

    expect(userFindMany).toHaveBeenCalledWith({
      where: { role: { in: ['manager', 'leader'] }, isActive: true },
      select: CHANNEL_RECIPIENT_SELECT,
    });
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(2);
  });

  it('настройка из одних пробелов равна «не задано»', async () => {
    getSettingValue.mockResolvedValue('   ');
    const { prisma, userFindMany } = db();

    await notifyManagersClientRequestSubmitted(prisma, websiteRequest());

    expect(userFindMany.mock.calls[0][0].where).not.toHaveProperty('id');
  });

  it('менеджеров организации для заявки с сайта не ищем — организации у неё нет', async () => {
    const { prisma } = db();

    await notifyManagersClientRequestSubmitted(prisma, websiteRequest());

    expect(resolveOrgManagerRecipients).not.toHaveBeenCalled();
  });

  it('адресатов не нашлось — уведомлений нет, но и падения нет', async () => {
    const { prisma } = db([]);

    await notifyManagersClientRequestSubmitted(prisma, websiteRequest());

    expect(createNotification).not.toHaveBeenCalled();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it('ДЕФЕКТ (в отчёт): менеджер по умолчанию уволен — заявку не увидит никто', async () => {
    // Настройка указывает на человека, который больше не активен (или сменил
    // роль). Выборка возвращает пусто, отката «тогда всему контуру» нет —
    // заявка с сайта тихо остаётся без уведомления.
    getSettingValue.mockResolvedValue('u-fired');
    const { prisma } = db([]);

    await notifyManagersClientRequestSubmitted(prisma, websiteRequest());

    expect(createNotification).not.toHaveBeenCalled();
  });

  it('ДЕФЕКТ (в отчёт): контур ЦО берётся без привязки к компании', async () => {
    // У заявки с сайта нет компании-продавца, и выборка адресатов не
    // ограничена ничем: в системе с несколькими компаниями уведомление уйдёт
    // менеджерам всех сразу.
    const { prisma, userFindMany } = db([{ id: 'm1' }]);

    await notifyManagersClientRequestSubmitted(prisma, websiteRequest());

    expect(userFindMany.mock.calls[0][0].where).not.toHaveProperty('companyId');
  });
});

// ─── заголовок ────────────────────────────────────────────────────────────────

describe('заявка с сайта — заголовок уведомления', () => {
  it('«Новая заявка с сайта» — чтобы менеджер сразу видел, что клиента в системе нет', async () => {
    const { prisma } = db([{ id: 'm1' }]);

    await notifyManagersClientRequestSubmitted(prisma, websiteRequest());

    expect(createNotification.mock.calls[0][0]).toMatchObject({
      type: 'client_request_submitted',
      title: 'Новая заявка с сайта',
      body: 'ООО Ромашка: Обучение по охране труда',
      organizationId: null,
      partnerId: null,
      meta: { requestId: 'R-site-1', url: '/manager/requests' },
    });
    expect(deliverNotificationToUser.mock.calls[0][0]).toMatchObject({
      title: 'Новая заявка с сайта',
      url: '/manager/requests',
      dedupKey: 'n-m1',
    });
  });

  it('у заявки из кабинета заголовок прежний — «Новое обращение клиента»', async () => {
    resolveOrgManagerRecipients.mockResolvedValue([{ id: 'm1' }]);
    const { prisma } = db();

    await notifyManagersClientRequestSubmitted(
      prisma,
      websiteRequest({
        source: 'organization_cabinet',
        organizationId: 'org-1',
        submittedByUserId: 'u-1',
      })
    );

    expect(createNotification.mock.calls[0][0].title).toBe('Новое обращение клиента');
  });

  it('сбой рассылки проглатывается: заявка уже принята', async () => {
    createNotification.mockRejectedValue(new Error('почта отвалилась'));
    const { prisma } = db([{ id: 'm1' }]);

    await expect(
      notifyManagersClientRequestSubmitted(prisma, websiteRequest())
    ).resolves.toBeUndefined();
    expect(logWarn).toHaveBeenCalledWith('[clientRequests/notify] submit notify failed', {
      requestId: 'R-site-1',
      error: 'почта отвалилась',
    });
  });
});

// ─── смена статуса ────────────────────────────────────────────────────────────

describe('смена статуса заявки без автора', () => {
  it('уведомлять некого: ни строки в базе, ни доставки', async () => {
    const { prisma } = db();

    await notifySubmitterClientRequestStatus(
      prisma,
      websiteRequest({ status: 'in_triage' } as Partial<ClientRequest>)
    );

    expect(createNotification).not.toHaveBeenCalled();
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it('отклонение заявки с сайта тоже никого не будит', async () => {
    const { prisma } = db();

    await notifySubmitterClientRequestStatus(
      prisma,
      websiteRequest({
        status: 'rejected',
        rejectedReason: 'не наш профиль',
      } as Partial<ClientRequest>)
    );

    expect(createNotification).not.toHaveBeenCalled();
  });

  it('у заявки с автором уведомление по-прежнему уходит', async () => {
    const { prisma } = db();

    await notifySubmitterClientRequestStatus(
      prisma,
      websiteRequest({
        source: 'organization_cabinet',
        submittedByUserId: 'u-1',
        status: 'in_triage',
      } as Partial<ClientRequest>)
    );

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][0].userId).toBe('u-1');
  });
});
