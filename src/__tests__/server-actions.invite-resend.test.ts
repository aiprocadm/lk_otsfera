import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Этап 4 (ФТ-10.2): resendInviteAction — тонкий адаптер (§3): сессия из
 * requireSession, вся доменная логика (скоупы/гашение токенов/rate-limit)
 * в сервисе resendInvite; здесь пиннится только склейка и защита от кривого
 * userId до похода в сервис.
 */

const { requireSession, resendInvite } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  resendInvite: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/services/team/resend', () => ({ resendInvite }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { __tag: 'prisma-singleton' } }));

import { prisma } from '@/lib/db/prisma';
import { resendInviteAction } from '@/server-actions/invite-resend';

const SESSION = { sub: 'admin-1', role: 'admin' as const };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
});

describe('resendInviteAction — happy path', () => {
  it('прокидывает prisma-синглтон, сессию и userId в сервис; результат отдаёт как есть', async () => {
    resendInvite.mockResolvedValue({ ok: true, inviteUrl: 'https://app/reset-password?token=n', emailStatus: 'sent' });

    const res = await resendInviteAction({ userId: 'u-1' });

    expect(res).toEqual({ ok: true, inviteUrl: 'https://app/reset-password?token=n', emailStatus: 'sent' });
    expect(requireSession).toHaveBeenCalledTimes(1);
    expect(resendInvite).toHaveBeenCalledWith(prisma, SESSION, { userId: 'u-1', sendEmail: true });
  });

  it('ошибки сервиса возвращаются без переупаковки', async () => {
    resendInvite.mockResolvedValue({ ok: false, error: 'rate_limited' });

    const res = await resendInviteAction({ userId: 'u-1' });

    expect(res).toEqual({ ok: false, error: 'rate_limited' });
  });
});

describe('resendInviteAction — кривой userId не доходит до сервиса', () => {
  it('пустая строка → not_found, сервис не вызван', async () => {
    const res = await resendInviteAction({ userId: '' });

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(resendInvite).not.toHaveBeenCalled();
  });

  it('не-строка (обход типов с клиента) → not_found, сервис не вызван', async () => {
    const res = await resendInviteAction({ userId: 123 as unknown as string });

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(resendInvite).not.toHaveBeenCalled();
  });
});

describe('resendInviteAction — проброс sendEmail', () => {
  it('sendEmail:false → в сервис уходит sendEmail:false (режим «Скопировать ссылку»)', async () => {
    resendInvite.mockResolvedValue({ ok: true, inviteUrl: 'https://x', emailStatus: 'skipped' });

    await resendInviteAction({ userId: 'u-2', sendEmail: false });

    expect(resendInvite).toHaveBeenCalledWith(prisma, SESSION, { userId: 'u-2', sendEmail: false });
  });

  it('sendEmail не указан → дефолт true', async () => {
    resendInvite.mockResolvedValue({ ok: true, inviteUrl: 'https://x', emailStatus: 'sent' });

    await resendInviteAction({ userId: 'u-3' });

    expect(resendInvite).toHaveBeenCalledWith(prisma, SESSION, { userId: 'u-3', sendEmail: true });
  });

  it('sendEmail:true явно → true', async () => {
    resendInvite.mockResolvedValue({ ok: true, inviteUrl: 'https://x', emailStatus: 'sent' });

    await resendInviteAction({ userId: 'u-4', sendEmail: true });

    expect(resendInvite).toHaveBeenCalledWith(prisma, SESSION, { userId: 'u-4', sendEmail: true });
  });
});

describe('resendInviteAction — сессия обязательна', () => {
  it('requireSession редиректит (throw) → сервис не вызывается', async () => {
    requireSession.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(resendInviteAction({ userId: 'u-1' })).rejects.toThrow('NEXT_REDIRECT');
    expect(resendInvite).not.toHaveBeenCalled();
  });
});
