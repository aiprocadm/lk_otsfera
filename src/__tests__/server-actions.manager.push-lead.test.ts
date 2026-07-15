import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireManager,
  revalidatePath,
  leadFindUnique,
  recordAudit,
  queueAdd,
  getQueue,
  logError
} = vi.hoisted(() => {
  const queueAdd = vi.fn();
  return {
    requireManager: vi.fn(),
    revalidatePath: vi.fn(),
    leadFindUnique: vi.fn(),
    recordAudit: vi.fn(),
    queueAdd,
    getQueue: vi.fn(() => ({ add: queueAdd })),
    logError: vi.fn()
  };
});

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { lead: { findUnique: leadFindUnique } } }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));
vi.mock('@/lib/logging', () => ({ log: { error: logError } }));

import { pushLeadToOneCAction } from '@/server-actions/manager/leads';

const MGR = { sub: 'mgr-1', role: 'manager', managedOrgIds: [], companyId: 'co-1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue(MGR);
});

describe('pushLeadToOneCAction', () => {
  it('validation при пустом leadId — до prisma не доходит', async () => {
    const res = await pushLeadToOneCAction({ leadId: '' });
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(leadFindUnique).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('validation при leadId длиннее 64 символов', async () => {
    const res = await pushLeadToOneCAction({ leadId: 'x'.repeat(65) });
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(leadFindUnique).not.toHaveBeenCalled();
  });

  it('not_found когда лида нет', async () => {
    leadFindUnique.mockResolvedValue(null);
    const res = await pushLeadToOneCAction({ leadId: 'missing' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(leadFindUnique).toHaveBeenCalledWith({
      where: { id: 'missing' },
      select: { id: true, pushedToOneCAt: true }
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('already_pushed когда pushedToOneCAt уже установлен — повторная постановка запрещена', async () => {
    leadFindUnique.mockResolvedValue({ id: 'l1', pushedToOneCAt: new Date('2026-06-05') });
    const res = await pushLeadToOneCAction({ leadId: 'l1' });
    expect(res).toEqual({ ok: false, error: 'already_pushed' });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('успех: джоба с идемпотентным jobId + аудит + revalidatePath', async () => {
    leadFindUnique.mockResolvedValue({ id: 'l1', pushedToOneCAt: null });
    queueAdd.mockResolvedValue({ id: 'job-1' });

    const res = await pushLeadToOneCAction({ leadId: 'l1' });

    expect(res).toEqual({ ok: true });
    expect(getQueue).toHaveBeenCalledWith('oneCSync.pushLead');
    expect(queueAdd).toHaveBeenCalledWith('push', { leadId: 'l1' }, { jobId: 'push-lead:l1' });
    expect(recordAudit).toHaveBeenCalledWith(expect.anything(), {
      action: 'lead_push_enqueued',
      entity: 'lead',
      entityId: 'l1',
      userId: 'mgr-1'
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/leads/l1');
    expect(logError).not.toHaveBeenCalled();
  });

  it('queue_error при reject add: логирует, не бросает, аудит/revalidate не выполняются', async () => {
    leadFindUnique.mockResolvedValue({ id: 'l1', pushedToOneCAt: null });
    queueAdd.mockRejectedValue(new Error('redis down'));

    const res = await pushLeadToOneCAction({ leadId: 'l1' });

    expect(res).toEqual({ ok: false, error: 'queue_error' });
    expect(logError).toHaveBeenCalledWith('[manager/leads] push lead enqueue failed', {
      leadId: 'l1',
      error: 'redis down'
    });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('queue_error при синхронном throw getQueue (нет REDIS_URL) и не-Error значении', async () => {
    leadFindUnique.mockResolvedValue({ id: 'l2', pushedToOneCAt: null });
    getQueue.mockImplementationOnce(() => {
      // getRedisConnection бросает синхронно при отсутствующем REDIS_URL
      throw 'REDIS_URL is not set';
    });

    const res = await pushLeadToOneCAction({ leadId: 'l2' });

    expect(res).toEqual({ ok: false, error: 'queue_error' });
    expect(logError).toHaveBeenCalledWith('[manager/leads] push lead enqueue failed', {
      leadId: 'l2',
      error: 'REDIS_URL is not set'
    });
  });
});
