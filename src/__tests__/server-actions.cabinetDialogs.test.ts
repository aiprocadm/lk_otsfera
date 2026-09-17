import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, revalidatePath, replyFromCabinet } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  replyFromCabinet: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/services/cabinetDialogs/reply', () => ({ replyFromCabinet }));

import { replyFromCabinetAction } from '@/server-actions/cabinetDialogs';

/** `У-234`: отправка сообщения менеджеру из кабинета. */
function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}

const SESSION = { sub: 'u1', role: 'organization' };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
  replyFromCabinet.mockResolvedValue({ ok: true });
});

describe('replyFromCabinetAction', () => {
  it('гард сессии, текст в сервис, оба кабинета перечитываются', async () => {
    expect(await replyFromCabinetAction(fd({ text: 'Здравствуйте' }))).toEqual({ ok: true });
    expect(requireSession).toHaveBeenCalled();
    expect(replyFromCabinet).toHaveBeenCalledWith({}, SESSION, 'Здравствуйте');
    expect(revalidatePath).toHaveBeenCalledWith('/organization/messages');
    expect(revalidatePath).toHaveBeenCalledWith('/partner/messages');
  });

  it('пустое поле уходит в сервис — лимиты и отказ его (§3)', async () => {
    replyFromCabinet.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Опишите вопрос'],
    });
    expect(await replyFromCabinetAction(fd({}))).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Опишите вопрос'],
    });
    expect(replyFromCabinet).toHaveBeenCalledWith({}, SESSION, '');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('без сессии гард бросает — сервис не зовётся', async () => {
    requireSession.mockRejectedValue(new Error('REDIRECT'));
    await expect(replyFromCabinetAction(fd({ text: 'x' }))).rejects.toThrow('REDIRECT');
    expect(replyFromCabinet).not.toHaveBeenCalled();
  });
});
