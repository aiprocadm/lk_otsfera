import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSession, generateLinkCode, unlinkTelegram } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  generateLinkCode: vi.fn(),
  unlinkTelegram: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/telegram/link', () => ({ generateLinkCode, unlinkTelegram }));

import { generateTelegramLinkAction, unlinkTelegramAction } from '@/server-actions/telegram';

const SESSION = { sub: 'user-1', role: 'partner' as const };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
});

describe('generateTelegramLinkAction', () => {
  it('requires a session and delegates to generateLinkCode', async () => {
    generateLinkCode.mockResolvedValue({ code: 'ABC123', expiresAt: '2026-06-28T00:00:00.000Z' });

    const res = await generateTelegramLinkAction();

    expect(requireSession).toHaveBeenCalledOnce();
    expect(generateLinkCode).toHaveBeenCalledWith(expect.anything(), SESSION);
    expect(res).toEqual({ code: 'ABC123', expiresAt: '2026-06-28T00:00:00.000Z' });
  });
});

describe('unlinkTelegramAction', () => {
  it('requires a session and delegates to unlinkTelegram', async () => {
    unlinkTelegram.mockResolvedValue({ ok: true });

    const res = await unlinkTelegramAction();

    expect(requireSession).toHaveBeenCalledOnce();
    expect(unlinkTelegram).toHaveBeenCalledWith(expect.anything(), SESSION);
    expect(res).toEqual({ ok: true });
  });
});
