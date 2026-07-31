/**
 * Unit tests for src/lib/services/clientRequests/notify.ts (этап 5, Модуль 1).
 *
 * notifyManagersClientRequestSubmitted — fan-out менеджерам: org-заявка через
 * resolveOrgManagerRecipients; партнёрская — менеджеры организаций партнёра
 * (дедуп + исключение подателя); некому → без createNotification.
 * notifySubmitterClientRequestStatus — url по source, причина отказа в body,
 * dedupKey = id Notification-строки. Обе best-effort: сбой → log.warn.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createNotification, deliverNotificationToUser, resolveOrgManagerRecipients } = vi.hoisted(() => ({
  createNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  resolveOrgManagerRecipients: vi.fn()
}));
vi.mock('@/lib/notifications', () => ({
  createNotification,
  deliverNotificationToUser,
  resolveOrgManagerRecipients
}));

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  log: { warn: logWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import type { ClientRequest } from '@prisma/client';
import { CHANNEL_RECIPIENT_SELECT } from '@/lib/notifications/channels/types';
import {
  notifyManagersClientRequestSubmitted,
  notifySubmitterClientRequestStatus,
  submitterRequestUrl
} from '@/lib/services/clientRequests/notify';

// ─── helpers ──────────────────────────────────────────────────────────────────

const request = (over: Partial<ClientRequest> = {}): ClientRequest =>
  ({
    id: 'R1',
    source: 'partner_cabinet',
    status: 'submitted',
    submittedByUserId: 'sub-1',
    partnerId: 'p1',
    organizationId: null,
    companyName: 'ООО Ромашка',
    subject: 'Обучение',
    rejectedReason: null,
    ...over
  }) as ClientRequest;

function db(over: Record<string, unknown> = {}) {
  const omFindMany = vi.fn().mockResolvedValue([]);
  const userFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    organizationManager: { findMany: omFindMany },
    user: { findMany: userFindMany },
    ...over
  };
  return { prisma: prisma as never, omFindMany, userFindMany };
}

beforeEach(() => {
  vi.clearAllMocks();
  createNotification.mockImplementation(async ({ userId }: { userId: string }) => ({ id: `n-${userId}` }));
  deliverNotificationToUser.mockResolvedValue({});
  resolveOrgManagerRecipients.mockResolvedValue([]);
});

// ─── submitterRequestUrl ──────────────────────────────────────────────────────

describe('submitterRequestUrl', () => {
  it('partner_cabinet → /partner/requests/<id>, иначе — /organization/requests/<id>', () => {
    expect(submitterRequestUrl({ id: 'R1', source: 'partner_cabinet' })).toBe('/partner/requests/R1');
    expect(submitterRequestUrl({ id: 'R2', source: 'organization_cabinet' })).toBe('/organization/requests/R2');
    expect(submitterRequestUrl({ id: 'R3', source: 'website' })).toBe('/organization/requests/R3');
  });
});

// ─── notifyManagersClientRequestSubmitted ─────────────────────────────────────

describe('notifyManagersClientRequestSubmitted — org-заявка', () => {
  it('получатели через resolveOrgManagerRecipients (податель исключён); нотификация + доставка каждому', async () => {
    resolveOrgManagerRecipients.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    const { prisma, omFindMany } = db();
    const req = request({ source: 'organization_cabinet', organizationId: 'o1', partnerId: null });
    await notifyManagersClientRequestSubmitted(prisma, req);

    expect(resolveOrgManagerRecipients).toHaveBeenCalledWith(prisma, 'o1', { excludeUserId: 'sub-1' });
    expect(omFindMany).not.toHaveBeenCalled(); // партнёрская ветка не задействована
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith({
      userId: 'm1',
      organizationId: 'o1',
      partnerId: null,
      type: 'client_request_submitted',
      title: 'Новое обращение клиента',
      body: 'ООО Ромашка: Обучение',
      meta: { requestId: 'R1', url: '/manager/requests' }
    });
    expect(deliverNotificationToUser).toHaveBeenCalledWith({
      userId: 'm2',
      title: 'Новое обращение клиента',
      body: 'ООО Ромашка: Обучение',
      type: 'client_request_submitted',
      url: '/manager/requests',
      dedupKey: 'n-m2'
    });
  });
});

describe('notifyManagersClientRequestSubmitted — партнёрская заявка', () => {
  it('менеджеры организаций партнёра: выборка по partnerId, дедуп userId, исключение подателя, select узкий', async () => {
    const { prisma, omFindMany, userFindMany } = db();
    omFindMany.mockResolvedValue([
      { userId: 'm1' },
      { userId: 'm1' }, // дубль (менеджер на двух организациях)
      { userId: 'sub-1' }, // сам податель
      { userId: 'm2' }
    ]);
    userFindMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);

    await notifyManagersClientRequestSubmitted(prisma, request());

    expect(resolveOrgManagerRecipients).not.toHaveBeenCalled();
    expect(omFindMany).toHaveBeenCalledWith({
      where: { isActive: true, organization: { partnerId: 'p1' } },
      select: { userId: true }
    });
    expect(userFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] }, role: 'manager', isActive: true },
      select: CHANNEL_RECIPIENT_SELECT
    });
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(2);
  });

  it('после дедупа/исключения никого → user.findMany не зовётся, уведомлений нет', async () => {
    const { prisma, userFindMany } = db();
    (prisma as { organizationManager: { findMany: ReturnType<typeof vi.fn> } }).organizationManager.findMany =
      vi.fn().mockResolvedValue([{ userId: 'sub-1' }]);
    await notifyManagersClientRequestSubmitted(prisma, request());
    expect(userFindMany).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
  });

  it('нет ни организации, ни партнёра (website) → тихо без fan-out', async () => {
    const { prisma, omFindMany } = db();
    await notifyManagersClientRequestSubmitted(prisma, request({ source: 'website', partnerId: null }));
    expect(resolveOrgManagerRecipients).not.toHaveBeenCalled();
    expect(omFindMany).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('best-effort: сбой резолва получателей проглатывается с log.warn', async () => {
    resolveOrgManagerRecipients.mockRejectedValue(new Error('db down'));
    const { prisma } = db();
    await expect(
      notifyManagersClientRequestSubmitted(prisma, request({ organizationId: 'o1' }))
    ).resolves.toBeUndefined();
    expect(logWarn).toHaveBeenCalledWith(
      '[clientRequests/notify] submit notify failed',
      expect.objectContaining({ requestId: 'R1', error: 'db down' })
    );
  });

  it('best-effort: отказ не-Error значением логируется текстом, а не undefined', async () => {
    // Драйвер/сеть могут отвергнуть промис строкой. Без String(err) в лог ушло бы
    // `error: undefined`, и разбирать инцидент было бы нечем.
    resolveOrgManagerRecipients.mockRejectedValue('соединение закрыто');
    const { prisma } = db();
    await expect(
      notifyManagersClientRequestSubmitted(prisma, request({ organizationId: 'o1' }))
    ).resolves.toBeUndefined();
    expect(logWarn).toHaveBeenCalledWith(
      '[clientRequests/notify] submit notify failed',
      expect.objectContaining({ requestId: 'R1', error: 'соединение закрыто' })
    );
  });
});

// ─── notifySubmitterClientRequestStatus ───────────────────────────────────────

describe('notifySubmitterClientRequestStatus', () => {
  it('партнёрская заявка: url /partner/requests/<id>, русская подпись статуса, dedupKey = id строки', async () => {
    const { prisma } = db();
    await notifySubmitterClientRequestStatus(prisma, request({ status: 'in_triage' }));
    expect(createNotification).toHaveBeenCalledWith({
      userId: 'sub-1',
      organizationId: null,
      partnerId: 'p1',
      type: 'client_request_status_changed',
      title: 'Обращение — статус «В работе»',
      body: 'Обращение «Обучение» (ООО Ромашка) — статус «В работе».',
      meta: { requestId: 'R1', status: 'in_triage', url: '/partner/requests/R1' }
    });
    expect(deliverNotificationToUser).toHaveBeenCalledWith({
      userId: 'sub-1',
      title: 'Обращение — статус «В работе»',
      body: 'Обращение «Обучение» (ООО Ромашка) — статус «В работе».',
      type: 'client_request_status_changed',
      url: '/partner/requests/R1',
      dedupKey: 'n-sub-1'
    });
  });

  it('организационная заявка: url /organization/requests/<id>; статус converted → «Принята»', async () => {
    const { prisma } = db();
    await notifySubmitterClientRequestStatus(
      prisma,
      request({ source: 'organization_cabinet', organizationId: 'o1', partnerId: null, status: 'converted' })
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Обращение — статус «Принята»',
        meta: { requestId: 'R1', status: 'converted', url: '/organization/requests/R1' }
      })
    );
  });

  it('rejected: причина отказа попадает в body', async () => {
    const { prisma } = db();
    await notifySubmitterClientRequestStatus(
      prisma,
      request({ status: 'rejected', rejectedReason: 'нет мест' })
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Обращение «Обучение» (ООО Ромашка) — статус «Отклонена». Причина: нет мест'
      })
    );
  });

  it('rejected без причины: хвоста «Причина:» нет', async () => {
    const { prisma } = db();
    await notifySubmitterClientRequestStatus(prisma, request({ status: 'rejected', rejectedReason: null }));
    const body = createNotification.mock.calls[0][0].body as string;
    expect(body).toBe('Обращение «Обучение» (ООО Ромашка) — статус «Отклонена».');
  });

  it('best-effort: reject из createNotification проглатывается + log.warn; доставки нет', async () => {
    createNotification.mockRejectedValue(new Error('insert failed'));
    const { prisma } = db();
    await expect(
      notifySubmitterClientRequestStatus(prisma, request({ status: 'in_triage' }))
    ).resolves.toBeUndefined();
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(
      '[clientRequests/notify] status notify failed',
      expect.objectContaining({ requestId: 'R1', error: 'insert failed' })
    );
  });

  it('best-effort: отказ не-Error значением логируется текстом', async () => {
    createNotification.mockRejectedValue('соединение закрыто');
    const { prisma } = db();
    await expect(
      notifySubmitterClientRequestStatus(prisma, request({ status: 'in_triage' }))
    ).resolves.toBeUndefined();
    expect(logWarn).toHaveBeenCalledWith(
      '[clientRequests/notify] status notify failed',
      expect.objectContaining({ requestId: 'R1', error: 'соединение закрыто' })
    );
  });
});
