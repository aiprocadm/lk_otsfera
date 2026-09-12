import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const m = vi.hoisted(() => ({ appendInboundToDialog: vi.fn() }));
vi.mock('@/lib/services/messengers/appendInbound', () => ({
  appendInboundToDialog: m.appendInboundToDialog,
}));

import {
  backfillDialogsFromInbound,
  countPendingBackfill,
} from '@/lib/services/messengers/backfill';

/**
 * Ветки бэкфилла, которых не достать на живой базе: размер пачки по
 * умолчанию и гонка «вебхук сложил письмо между выборкой и записью» (реплика
 * уже есть → `deduped`, в отчёте не считается добавленной). Сам обход — в
 * `messengers.backfill.integration`.
 */
const findMany = vi.fn();
const count = vi.fn();
const prisma = { inboundMessage: { findMany, count } } as unknown as PrismaClient;

const row = {
  id: 'im-1',
  channel: 'telegram',
  senderRef: 'chat-1',
  senderDisplay: null,
  body: 'x',
  externalId: 'tg:1',
  sentAt: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  companyId: null,
  resolvedOrgId: null,
  contactId: null,
  resolvedUserId: null,
};

describe('backfillDialogsFromInbound (unit)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('без опций берёт пачку по умолчанию и не считает deduped-реплику добавленной', async () => {
    findMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    m.appendInboundToDialog.mockResolvedValue({
      ok: true,
      dialogId: 'd1',
      messageId: 'mm1',
      deduped: true,
    });

    await expect(backfillDialogsFromInbound(prisma)).resolves.toEqual({ scanned: 1, appended: 0 });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({ take: 200 });
    expect(m.appendInboundToDialog).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        inboundMessageId: 'im-1',
        channel: 'telegram',
        sentAt: row.createdAt,
        binding: null,
        markUnread: false,
      })
    );
  });

  it('countPendingBackfill считает письма мессенджеров без реплики', async () => {
    count.mockResolvedValue(7);
    await expect(countPendingBackfill(prisma)).resolves.toBe(7);
    expect(count).toHaveBeenCalledWith({
      where: { channel: { in: ['telegram', 'max', 'whatsapp'] }, dialogMessage: null },
    });
  });
});
