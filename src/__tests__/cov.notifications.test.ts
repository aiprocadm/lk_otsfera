/**
 * Track E / E1 — coverage-restoration unit tests for the notifications module.
 *
 * Targets the branches that drifted below 100% after later tracks merged. All
 * of them live on the **D5 "queued" path** of the fan-out helpers plus a few
 * defensive/edge arms in the dispatcher and the worker processor:
 *
 *   - manager.ts   338-341, 438-441 (queued arm) + branches 337,349,437,459
 *   - org.ts       294-297 (queued arm) + branches 293,315
 *   - partner.ts   187-190 (queued arm) + branches 186,208
 *   - core.ts      branch 88 (dispatch returns queued → deliver returns {})
 *   - channels/dispatch.ts branch 71 (enqueue throws a non-Error → String(err))
 *   - worker/processors/dispatch-notification.ts branches 75,89,93,101,105
 *
 * Strategy: mock the channel **registry** so `getChannels()` returns two fully
 * controllable fake channels (email + telegram). The real `dispatchToRecipient`
 * / `deliverToRecipient` then run against them. Queue mode is switched on with
 * env (`FEATURE_NOTIF_QUEUE` + `REDIS_URL`) and `getQueue` is mocked so no real
 * BullMQ/Redis is touched. Pure unit — no PrismaClient (fake db objects only).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { emailSend, telegramSend, telegramEnabled, queueAdd, getQueue, userFindUnique } = vi.hoisted(
  () => {
    const queueAdd = vi.fn();
    return {
      emailSend: vi.fn(),
      telegramSend: vi.fn(),
      // Controls the fake telegram channel's isEnabledFor gate (mirrors isTelegramEnabled()).
      telegramEnabled: { value: false },
      queueAdd,
      getQueue: vi.fn(() => ({ add: queueAdd })),
      userFindUnique: vi.fn(),
    };
  }
);

// Fake channel registry — the single seam every SUT flows through.
// isEnabledFor reads recipient fields directly (mirrors the real email/telegram
// channels) so the same fakes drive email-only, telegram-only and mixed fan-outs.
vi.mock('@/lib/notifications/channels/registry', () => ({
  getChannels: () => [
    {
      key: 'email',
      isEnabledFor: (u: { email: string | null }) => !!u.email,
      send: emailSend,
    },
    {
      key: 'telegram',
      isEnabledFor: (u: { telegramChatId: string | null }) =>
        telegramEnabled.value && !!u.telegramChatId,
      send: telegramSend,
    },
  ],
}));

vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

// core.ts talks to the shared prisma singleton.
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: userFindUnique } },
}));

import { notifyManagers, notifyManagersOrderLess } from '@/lib/notifications/manager';
import { notifyOrgUsers } from '@/lib/notifications/org';
import { notifyPartnerUsers } from '@/lib/notifications/partner';
import { deliverNotificationToUser } from '@/lib/notifications/core';
import { dispatchToRecipient } from '@/lib/notifications/channels/dispatch';
import type { ChannelPayload, ChannelRecipient } from '@/lib/notifications/channels/types';

// ---------------------------------------------------------------------------
// Env / queue-mode helpers
// ---------------------------------------------------------------------------

const ENV_KEYS = ['FEATURE_NOTIF_QUEUE', 'REDIS_URL'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  telegramEnabled.value = false;
  emailSend.mockResolvedValue({ status: 'sent' });
  telegramSend.mockResolvedValue({ status: 'sent' });
  queueAdd.mockResolvedValue({ id: 'job1' });
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** Turn the D5 queue path on (real dispatchToRecipient will enqueue). */
function enableQueueMode() {
  process.env.FEATURE_NOTIF_QUEUE = '1';
  process.env.REDIS_URL = 'redis://localhost:6379';
}

// Recipient shapes: one that only enables email, one that only enables telegram.
const EMAIL_RECIP = { id: 'm1', email: 'm1@x.ru', name: 'Mgr', telegramChatId: null };
const TELEGRAM_ONLY_RECIP = { id: 'm2', email: null, name: 'Tg', telegramChatId: 'tg-2' };

// ---------------------------------------------------------------------------
// manager.ts — notifyManagers queued arm (438-441) + branches 437,459
// ---------------------------------------------------------------------------

function managerDb(recipients: Array<Record<string, unknown>>) {
  const create = vi
    .fn()
    .mockImplementation((args: { data: { userId: string } }) =>
      Promise.resolve({ id: `notif-${args.data.userId}` })
    );
  return {
    db: {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'o1',
          orderNumber: '123',
          title: 'T',
          managerId: 'm1',
          organizationId: 'org1',
        }),
      },
      organizationManager: { findMany: vi.fn().mockResolvedValue([]) },
      comment: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue(recipients) },
      notification: { create },
    } as never,
    create,
  };
}

describe('notifyManagers — D5 queued path', () => {
  it('email queued → emailsQueued counted and surfaced in summary (branch 438,459 truthy)', async () => {
    enableQueueMode();
    const { db, create } = managerDb([EMAIL_RECIP]);

    const r = await notifyManagers(db, {
      orderId: 'o1',
      type: 'comment_from_org',
      payload: { orgName: 'ООО', commentExcerpt: 'hi' },
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsQueued).toBe(1);
    expect(r.emailsSent).toBe(0);
    expect(r.emailsSkipped).toBe(0);
    // transport never fires on the queued path — the worker would deliver
    expect(emailSend).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
    // dedupKey threaded to the queue jobId (row id)
    expect(queueAdd).toHaveBeenCalledWith(
      'deliver',
      expect.objectContaining({ userId: 'm1', channel: 'email' }),
      { jobId: 'notif_notif-m1_m1_email' }
    );
  });

  it('non-email queued (telegram only) → emailsSkipped, emailsQueued omitted (branch 439 + 459 falsy)', async () => {
    enableQueueMode();
    telegramEnabled.value = true;
    const { db } = managerDb([TELEGRAM_ONLY_RECIP]);

    const r = await notifyManagers(db, {
      orderId: 'o1',
      type: 'comment_from_org',
      payload: { orgName: 'ООО', commentExcerpt: 'hi' },
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsSkipped).toBe(1);
    expect(r.emailsSent).toBe(0);
    // emailsQueued stayed 0 → the `...(emailsQueued > 0 ? … : {})` falsy arm
    expect(r.emailsQueued).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// manager.ts — notifyManagersOrderLess queued arm (338-341) + branches 337,349
// ---------------------------------------------------------------------------

function orderLessDb(recipients: Array<Record<string, unknown>>) {
  const create = vi
    .fn()
    .mockImplementation((args: { data: { userId: string } }) =>
      Promise.resolve({ id: `notif-${args.data.userId}` })
    );
  return {
    db: {
      organizationManager: {
        findMany: vi.fn().mockResolvedValue(recipients.map((r) => ({ userId: r.id }))),
      },
      user: { findMany: vi.fn().mockResolvedValue(recipients) },
      notification: { create },
    } as never,
    create,
  };
}

describe('notifyManagersOrderLess — D5 queued path', () => {
  it('email queued → emailsQueued surfaced (branch 337,338,349 truthy)', async () => {
    enableQueueMode();
    const { db, create } = orderLessDb([EMAIL_RECIP]);

    const r = await notifyManagersOrderLess(db, {
      organizationId: 'org1',
      orgName: 'ООО Орг',
      documentName: 'gen.pdf',
      documentType: 'other',
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsQueued).toBe(1);
    expect(r.emailsSent).toBe(0);
    expect(r.emailsSkipped).toBe(0);
    expect(create).toHaveBeenCalledOnce();
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('non-email queued (telegram only) → emailsSkipped, emailsQueued omitted (branch 339 + 349 falsy)', async () => {
    enableQueueMode();
    telegramEnabled.value = true;
    const { db } = orderLessDb([{ id: 'm2', email: null, name: 'Tg', telegramChatId: 'tg-2' }]);

    const r = await notifyManagersOrderLess(db, {
      organizationId: 'org1',
      orgName: 'ООО Орг',
      documentName: 'gen.pdf',
      documentType: 'other',
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsSkipped).toBe(1);
    expect(r.emailsQueued).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// org.ts — notifyOrgUsers queued arm (294-297) + branches 293,315
// ---------------------------------------------------------------------------

function orgDb(recipients: Array<Record<string, unknown>>) {
  const create = vi
    .fn()
    .mockImplementation((args: { data: { userId: string } }) =>
      Promise.resolve({ id: `notif-${args.data.userId}` })
    );
  const organizationUsers = recipients.map((u) => ({
    user: {
      telegramChatId: null,
      maxChatId: null,
      whatsappPhone: null,
      notificationChannels: null,
      ...u,
    },
  }));
  return {
    db: {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'org-1', name: 'ООО Орг', organizationUsers }),
      },
      notification: { create },
    } as never,
    create,
  };
}

const ORG_ORDER_PAYLOAD = {
  orderId: 'ord-1',
  orderNumber: '007',
  orderTitle: 'Тест',
  amount: '100 000',
  paidAt: new Date('2026-06-01T00:00:00Z'),
} as const;

describe('notifyOrgUsers — D5 queued path', () => {
  it('email queued → emailsQueued surfaced (branch 293,294,315 truthy)', async () => {
    enableQueueMode();
    const { db, create } = orgDb([{ id: 'u1', email: 'u1@org.ru' }]);

    const r = await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'payment_received',
      payload: ORG_ORDER_PAYLOAD,
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsQueued).toBe(1);
    expect(r.emailsSent).toBe(0);
    expect(r.emailsSkipped).toBe(0);
    expect(create).toHaveBeenCalledOnce();
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('non-email queued (telegram only) → emailsSkipped, emailsQueued omitted (branch 295 + 315 falsy)', async () => {
    enableQueueMode();
    telegramEnabled.value = true;
    const { db } = orgDb([{ id: 'u2', email: null, telegramChatId: 'tg-u2' }]);

    const r = await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'payment_received',
      payload: ORG_ORDER_PAYLOAD,
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsSkipped).toBe(1);
    expect(r.emailsQueued).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// partner.ts — notifyPartnerUsers queued arm (187-190) + branches 186,208
// ---------------------------------------------------------------------------

function partnerDb(recipients: Array<Record<string, unknown>>) {
  const create = vi
    .fn()
    .mockImplementation((args: { data: { userId: string } }) =>
      Promise.resolve({ id: `notif-${args.data.userId}` })
    );
  const partnerUsers = recipients.map((u) => ({
    user: {
      telegramChatId: null,
      maxChatId: null,
      whatsappPhone: null,
      notificationChannels: null,
      ...u,
    },
  }));
  return {
    db: {
      partner: {
        findUnique: vi.fn().mockResolvedValue({ id: 'p-1', name: 'ООО Партнёр', partnerUsers }),
      },
      notification: { create },
    } as never,
    create,
  };
}

const PARTNER_DOC_PAYLOAD = {
  orderId: 'o1',
  orderNumber: '42',
  orderTitle: 'T',
  documentName: 'act.pdf',
  documentType: 'act',
} as const;

describe('notifyPartnerUsers — D5 queued path', () => {
  it('email queued → emailsQueued surfaced (branch 186,187,208 truthy)', async () => {
    enableQueueMode();
    const { db, create } = partnerDb([{ id: 'u1', email: 'u1@p.ru' }]);

    const r = await notifyPartnerUsers(db, {
      partnerId: 'p-1',
      type: 'document_published',
      payload: PARTNER_DOC_PAYLOAD,
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsQueued).toBe(1);
    expect(r.emailsSent).toBe(0);
    expect(r.emailsSkipped).toBe(0);
    expect(create).toHaveBeenCalledOnce();
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('non-email queued (telegram only) → emailsSkipped, emailsQueued omitted (branch 188 + 208 falsy)', async () => {
    enableQueueMode();
    telegramEnabled.value = true;
    const { db } = partnerDb([{ id: 'u2', email: null, telegramChatId: 'tg-u2' }]);

    const r = await notifyPartnerUsers(db, {
      partnerId: 'p-1',
      type: 'document_published',
      payload: PARTNER_DOC_PAYLOAD,
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsSkipped).toBe(1);
    expect(r.emailsQueued).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// core.ts — deliverNotificationToUser branch 88 (queued → return {})
// ---------------------------------------------------------------------------

describe('deliverNotificationToUser — dedupKey queued outcome', () => {
  const PAYLOAD = {
    userId: 'u-1',
    title: 'Уведомление',
    body: 'Тело',
    type: 'document_created',
    url: 'https://lk.example.ru/orders/42',
    dedupKey: 'notif-xyz',
  };

  it('dispatch returns mode=queued → deliver returns empty results ({} arm of branch 88)', async () => {
    enableQueueMode();
    userFindUnique.mockResolvedValue({
      id: 'u-1',
      email: 'partner@test.ru',
      name: 'Тест',
      telegramChatId: null,
      maxChatId: null,
      whatsappPhone: null,
      notificationChannels: null,
    });

    const results = await deliverNotificationToUser(PAYLOAD);

    // Queue mode → dispatch returns { mode: 'queued' } → core maps it to {}.
    expect(results).toEqual({});
    expect(emailSend).not.toHaveBeenCalled();
    expect(queueAdd).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// channels/dispatch.ts — branch 71: enqueue throws a non-Error → String(err)
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<ChannelRecipient> = {}): ChannelRecipient {
  return {
    id: 'u1',
    email: 'user@example.ru',
    name: 'Иван',
    telegramChatId: null,
    maxChatId: null,
    whatsappPhone: null,
    notificationChannels: null,
    ...overrides,
  };
}

const DISPATCH_PAYLOAD: ChannelPayload = {
  type: 'payment_received',
  title: 'Т',
  body: 'Б',
  email: { template: 'notification', props: { recipientName: 'Иван', title: 'Т', body: 'Б' } },
};

describe('dispatchToRecipient — enqueue failure with a non-Error thrown', () => {
  it('queue.add rejects with a string → warn logs String(err), falls back to inline (branch 71 false arm)', async () => {
    enableQueueMode();
    // Reject with a plain string, not an Error, to exercise `String(err)`.
    queueAdd.mockRejectedValue('redis-string-failure');
    emailSend.mockResolvedValue({ status: 'sent' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const outcome = await dispatchToRecipient(makeUser(), DISPATCH_PAYLOAD, { dedupKey: 'n-str' });

    expect(outcome.mode).toBe('inline');
    if (outcome.mode === 'inline') {
      expect(outcome.results.email).toEqual({ status: 'sent' });
    }
    expect(warnSpy).toHaveBeenCalledWith(
      '[notifications] enqueue failed — falling back to inline delivery',
      expect.objectContaining({ dedupKey: 'n-str', error: 'redis-string-failure' })
    );
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// worker/processors/dispatch-notification.ts — branches 75,89,93,101,105
// runDispatchNotification is exercised with a fake db + the fake channel
// registry so we control channel.send() return shapes precisely.
// ---------------------------------------------------------------------------

// Imported after the mocks above are registered.
import { runDispatchNotification } from '@/worker/processors/dispatch-notification';
import type { NotificationDispatchPayload } from '@/lib/jobs/types';

function fakeDbForWorker(overrides?: { syncLogCreate?: ReturnType<typeof vi.fn> }) {
  const syncLogCreate = overrides?.syncLogCreate ?? vi.fn().mockResolvedValue({});
  return {
    db: {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'wu1',
          email: 'wu1@test.ru',
          name: 'Worker User',
          telegramChatId: 'tg-wu1',
          maxChatId: null,
          whatsappPhone: null,
          notificationChannels: null,
        }),
      },
      syncLog: { create: syncLogCreate },
    } as never,
    syncLogCreate,
  };
}

function workerJob(
  overrides: Partial<NotificationDispatchPayload> = {}
): NotificationDispatchPayload {
  return {
    userId: 'wu1',
    channel: 'email',
    payload: { type: 'payment_received', title: 'Т', body: 'Б' },
    ...overrides,
  };
}

describe('runDispatchNotification — failure/edge branches', () => {
  it('channel.send throws a non-Error → reason = String(err) (branch 75 false arm)', async () => {
    // email channel enabled (user has email); send throws a bare string.
    emailSend.mockRejectedValue('plain-string-explosion');
    const { db, syncLogCreate } = fakeDbForWorker();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runDispatchNotification(db, workerJob(), 'job-str')).rejects.toThrow(
      'notification channel email failed: plain-string-explosion'
    );
    // reason threaded into SyncLog errorMessage
    expect(syncLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: 'plain-string-explosion' }),
      })
    );
    errSpy.mockRestore();
  });

  it('failed result with NO reason + NO jobId → externalId=null, errorMessage/throw fall back to "unknown" (branches 89,93,101)', async () => {
    // Channel returns failed without a reason → `result.reason ?? "unknown"`.
    emailSend.mockResolvedValue({ status: 'failed' });
    const { db, syncLogCreate } = fakeDbForWorker();

    // Called WITHOUT jobId → `jobId ?? null` false arm (externalId = null).
    await expect(runDispatchNotification(db, workerJob())).rejects.toThrow(
      'notification channel email failed: unknown'
    );
    expect(syncLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalId: null, errorMessage: 'unknown' }),
      })
    );
  });

  it('non-failed result carrying a reason → reason surfaced in return value (branch 105 truthy arm)', async () => {
    // Channel is enabled but returns skipped WITH a reason (e.g. pipeline off).
    // status !== 'failed' so we reach the final return: `result.reason ? {reason} : {}`.
    emailSend.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { db, syncLogCreate } = fakeDbForWorker();

    const result = await runDispatchNotification(db, workerJob(), 'job-skip');

    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    // No failure → SyncLog untouched.
    expect(syncLogCreate).not.toHaveBeenCalled();
  });
});
