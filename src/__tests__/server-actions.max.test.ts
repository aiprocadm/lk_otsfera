import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, generateMaxLinkCode, unlinkMax } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  generateMaxLinkCode: vi.fn(),
  unlinkMax: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/services/max/link', () => ({ generateMaxLinkCode, unlinkMax }));

import { generateMaxLinkAction, unlinkMaxAction } from '@/server-actions/max';

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ sub: 'u-1' });
});

describe('generateMaxLinkAction', () => {
  it('требует сессию и делегирует сервису', async () => {
    generateMaxLinkCode.mockResolvedValue({ ok: true, deepLink: 'https://max.ru/bot?start=x' });
    const result = await generateMaxLinkAction();
    expect(requireSession).toHaveBeenCalled();
    expect(generateMaxLinkCode).toHaveBeenCalledWith({}, { sub: 'u-1' });
    expect(result).toEqual({ ok: true, deepLink: 'https://max.ru/bot?start=x' });
  });
});

describe('unlinkMaxAction', () => {
  it('требует сессию и делегирует сервису', async () => {
    unlinkMax.mockResolvedValue({ ok: true });
    const result = await unlinkMaxAction();
    expect(requireSession).toHaveBeenCalled();
    expect(unlinkMax).toHaveBeenCalledWith({}, { sub: 'u-1' });
    expect(result).toEqual({ ok: true });
  });
});
