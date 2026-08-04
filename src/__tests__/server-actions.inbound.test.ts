/**
 * Тонкий адаптер: экшены инбокса только проверяют роль и прокидывают вызов в
 * сервисы (`bindInboundMessage` / `sendInboundReply`). Скоуп C8, форма запросов
 * Prisma и порядок побочных эффектов проверяются в тестах сервисов
 * (services.inbound.bind.test.ts, services.inbound.sendReply.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireManager, bindInboundMessage, sendInboundReply } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  bindInboundMessage: vi.fn(),
  sendInboundReply: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/inbound/bind', () => ({ bindInboundMessage }));
vi.mock('@/lib/services/inbound/sendReply', () => ({ sendInboundReply }));
vi.mock('@/lib/services/inbound/archive', () => ({
  archiveInboundMessage: vi.fn(),
  restoreInboundMessage: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/db/prisma';
import { bindInboundMessageAction, replyInboundAction } from '@/server-actions/inbound';

const SESSION = {
  sub: 'u-mgr-1',
  role: 'manager',
  companyId: 'company-a',
  managedOrgIds: ['org-a'],
};

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue(SESSION);
});

describe('bindInboundMessageAction', () => {
  it('требует менеджера и делегирует в сервис как есть', async () => {
    bindInboundMessage.mockResolvedValue({ ok: true });

    const result = await bindInboundMessageAction({
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
      orderId: 'ord-1',
      contactId: 'k1',
    });

    expect(result).toEqual({ ok: true });
    expect(requireManager).toHaveBeenCalledOnce();
    expect(bindInboundMessage).toHaveBeenCalledWith(prisma, SESSION, {
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
      orderId: 'ord-1',
      contactId: 'k1',
    });
  });

  it('прокидывает отказ сервиса без изменений (forbidden/not_found)', async () => {
    bindInboundMessage.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(
      await bindInboundMessageAction({ inboundMessageId: 'im-1', organizationId: 'org-a' })
    ).toEqual({ ok: false, error: 'forbidden' });

    bindInboundMessage.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(
      await bindInboundMessageAction({ inboundMessageId: 'im-1', organizationId: 'org-a' })
    ).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('replyInboundAction', () => {
  it('требует менеджера и делегирует в сервис как есть', async () => {
    sendInboundReply.mockResolvedValue({ ok: true });

    const result = await replyInboundAction({ inboundMessageId: 'im-1', text: 'hello' });

    expect(result).toEqual({ ok: true });
    expect(requireManager).toHaveBeenCalledOnce();
    expect(sendInboundReply).toHaveBeenCalledWith(prisma, SESSION, {
      inboundMessageId: 'im-1',
      text: 'hello',
    });
  });

  it('прокидывает коды отказа сервиса без изменений', async () => {
    for (const error of [
      'forbidden',
      'not_found',
      'invalid',
      'reply_failed',
      'email_unsupported',
    ]) {
      sendInboundReply.mockResolvedValue({ ok: false, error });
      expect(await replyInboundAction({ inboundMessageId: 'im-1', text: 'hi' })).toEqual({
        ok: false,
        error,
      });
    }
  });
});
