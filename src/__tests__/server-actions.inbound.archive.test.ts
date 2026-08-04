/**
 * Тонкий адаптер архива/восстановления инбокса: валидация формы входа (zod →
 * `validation`), гард роли, прокидка Result и revalidatePath. Скоуп C8, пин
 * компании, CAS и аудит проверяются в services.inbound.archive.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireManager, revalidatePath, archiveInboundMessage, restoreInboundMessage } = vi.hoisted(
  () => ({
    requireManager: vi.fn(),
    revalidatePath: vi.fn(),
    archiveInboundMessage: vi.fn(),
    restoreInboundMessage: vi.fn(),
  })
);

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/services/inbound/archive', () => ({
  archiveInboundMessage,
  restoreInboundMessage,
}));
vi.mock('@/lib/services/inbound/bind', () => ({ bindInboundMessage: vi.fn() }));
vi.mock('@/lib/services/inbound/sendReply', () => ({ sendInboundReply: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/db/prisma';
import { archiveInboundMessageAction, restoreInboundMessageAction } from '@/server-actions/inbound';

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

describe('archiveInboundMessageAction', () => {
  it('validation: пустой inboundMessageId — до auth и сервиса дело не доходит', async () => {
    const result = await archiveInboundMessageAction({ inboundMessageId: '' });

    expect(result).toEqual({ ok: false, error: 'validation' });
    expect(requireManager).not.toHaveBeenCalled();
    expect(archiveInboundMessage).not.toHaveBeenCalled();
  });

  it('validation: id длиннее 64 символов', async () => {
    const result = await archiveInboundMessageAction({ inboundMessageId: 'x'.repeat(65) });

    expect(result).toEqual({ ok: false, error: 'validation' });
    expect(archiveInboundMessage).not.toHaveBeenCalled();
  });

  it('успешная архивация: делегирует в сервис и ревалидирует инбокс', async () => {
    archiveInboundMessage.mockResolvedValue({ ok: true, changed: true });

    const result = await archiveInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: true });
    expect(archiveInboundMessage).toHaveBeenCalledWith(prisma, SESSION, {
      inboundMessageId: 'im-1',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/inbox');
  });

  it('идемпотентный повтор (changed:false) → ok:true БЕЗ ревалидации', async () => {
    archiveInboundMessage.mockResolvedValue({ ok: true, changed: false });

    const result = await archiveInboundMessageAction({ inboundMessageId: 'im-3' });

    expect(result).toEqual({ ok: true });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('прокидывает отказ сервиса без ревалидации', async () => {
    archiveInboundMessage.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await archiveInboundMessageAction({ inboundMessageId: 'im-1' })).toEqual({
      ok: false,
      error: 'forbidden',
    });

    archiveInboundMessage.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await archiveInboundMessageAction({ inboundMessageId: 'im-1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('restoreInboundMessageAction', () => {
  it('validation: пустой inboundMessageId', async () => {
    const result = await restoreInboundMessageAction({ inboundMessageId: '' });

    expect(result).toEqual({ ok: false, error: 'validation' });
    expect(restoreInboundMessage).not.toHaveBeenCalled();
  });

  it('успешное восстановление: делегирует в сервис и ревалидирует инбокс', async () => {
    restoreInboundMessage.mockResolvedValue({ ok: true });

    const result = await restoreInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: true });
    expect(restoreInboundMessage).toHaveBeenCalledWith(prisma, SESSION, {
      inboundMessageId: 'im-1',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/inbox');
  });

  it('прокидывает отказ сервиса без ревалидации', async () => {
    restoreInboundMessage.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await restoreInboundMessageAction({ inboundMessageId: 'im-1' })).toEqual({
      ok: false,
      error: 'not_found',
    });

    restoreInboundMessage.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await restoreInboundMessageAction({ inboundMessageId: 'im-1' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
