import { describe, it, expect, vi, beforeEach } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { warn } }));

import { recordWebhookEvent } from '@/lib/services/admin/webhookDiagnostics';

const upsert = vi.fn();
const prisma = { syncState: { upsert } } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordWebhookEvent', () => {
  it('пишет lastSuccessAt в SyncState webhook.<name>', async () => {
    upsert.mockResolvedValue({});
    await recordWebhookEvent(prisma, 'telegram');
    const { where, create, update } = upsert.mock.calls[0][0];
    expect(where).toEqual({ entity: 'webhook.telegram' });
    expect(create.entity).toBe('webhook.telegram');
    expect(create.lastSuccessAt).toBeInstanceOf(Date);
    expect(update.lastSuccessAt).toBeInstanceOf(Date);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never-throws: сбой записи глотается с log.warn', async () => {
    upsert.mockRejectedValue(new Error('db down'));
    await expect(recordWebhookEvent(prisma, 'mango')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      '[webhookDiagnostics] record failed',
      expect.objectContaining({ name: 'mango', error: 'db down' })
    );
  });

  it('не-Error сбой сериализуется в строку', async () => {
    upsert.mockRejectedValue('strange');
    await expect(recordWebhookEvent(prisma, 'whatsapp')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      '[webhookDiagnostics] record failed',
      expect.objectContaining({ error: 'strange' })
    );
  });
});
