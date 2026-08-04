/**
 * Unit-тесты сервиса `pushLeadToOneC` (src/lib/services/manager/leadPush.ts):
 * идемпотентность (pushedToOneCAt), timestamped jobId, деградация постановки в
 * queue_unavailable и аудит. Валидация формы входа и revalidatePath — в
 * server-actions.manager.push-lead.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { leadFindUnique, recordAudit, queueAdd, getQueue, logError } = vi.hoisted(() => {
  const queueAdd = vi.fn();
  return {
    leadFindUnique: vi.fn(),
    recordAudit: vi.fn(),
    queueAdd,
    getQueue: vi.fn(() => ({ add: queueAdd })),
    logError: vi.fn(),
  };
});

vi.mock('@/lib/db/prisma', () => ({ prisma: { lead: { findUnique: leadFindUnique } } }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));
vi.mock('@/lib/logging', () => ({ log: { error: logError } }));

import { prisma } from '@/lib/db/prisma';
import { pushLeadToOneC } from '@/lib/services/manager/leadPush';

const MGR: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: [],
  companyId: 'co-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pushLeadToOneC', () => {
  it('not_found когда лида нет', async () => {
    leadFindUnique.mockResolvedValue(null);
    const res = await pushLeadToOneC(prisma, MGR, { leadId: 'missing' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(leadFindUnique).toHaveBeenCalledWith({
      where: { id: 'missing' },
      select: { id: true, pushedToOneCAt: true },
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('already_pushed когда pushedToOneCAt уже установлен — повторная постановка запрещена', async () => {
    leadFindUnique.mockResolvedValue({ id: 'l1', pushedToOneCAt: new Date('2026-06-05') });
    const res = await pushLeadToOneC(prisma, MGR, { leadId: 'l1' });
    expect(res).toEqual({ ok: false, error: 'already_pushed' });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('успех: джоба с timestamped jobId (образец triggerSync) + аудит', async () => {
    leadFindUnique.mockResolvedValue({ id: 'l1', pushedToOneCAt: null });
    queueAdd.mockResolvedValue({ id: 'job-1' });

    const res = await pushLeadToOneC(prisma, MGR, { leadId: 'l1' });

    expect(res).toEqual({ ok: true });
    expect(getQueue).toHaveBeenCalledWith('oneCSync.pushLead');
    // Статический jobId при removeOnFail:false навсегда дедупил бы повторный
    // пуш после исчерпания attempts — поэтому суффикс-timestamp обязателен.
    expect(queueAdd).toHaveBeenCalledWith(
      'push',
      { leadId: 'l1' },
      { jobId: expect.stringMatching(/^push-lead:l1:\d+$/) }
    );
    expect(recordAudit).toHaveBeenCalledWith(expect.anything(), {
      action: 'lead_push_enqueued',
      entity: 'lead',
      entityId: 'l1',
      userId: 'mgr-1',
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('queue_unavailable при reject add: логирует, не бросает, аудит не выполняется', async () => {
    leadFindUnique.mockResolvedValue({ id: 'l1', pushedToOneCAt: null });
    queueAdd.mockRejectedValue(new Error('redis down'));

    const res = await pushLeadToOneC(prisma, MGR, { leadId: 'l1' });

    expect(res).toEqual({ ok: false, error: 'queue_unavailable' });
    expect(logError).toHaveBeenCalledWith('[manager/leads] push lead enqueue failed', {
      leadId: 'l1',
      error: 'redis down',
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('queue_unavailable при синхронном throw getQueue (нет REDIS_URL) и не-Error значении', async () => {
    leadFindUnique.mockResolvedValue({ id: 'l2', pushedToOneCAt: null });
    getQueue.mockImplementationOnce(() => {
      // getRedisConnection бросает синхронно при отсутствующем REDIS_URL
      throw 'REDIS_URL is not set';
    });

    const res = await pushLeadToOneC(prisma, MGR, { leadId: 'l2' });

    expect(res).toEqual({ ok: false, error: 'queue_unavailable' });
    expect(logError).toHaveBeenCalledWith('[manager/leads] push lead enqueue failed', {
      leadId: 'l2',
      error: 'REDIS_URL is not set',
    });
  });
});
