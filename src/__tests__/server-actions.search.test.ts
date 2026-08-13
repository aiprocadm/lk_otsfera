import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, globalSearch } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  globalSearch: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/services/search/globalSearch', () => ({ globalSearch }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { paletteSearchAction } from '@/server-actions/search';

const SESSION = { userId: 'u1', role: 'manager', companyId: 'c1' };

beforeEach(() => {
  requireSession.mockReset().mockResolvedValue(SESSION);
  globalSearch.mockReset().mockResolvedValue({ ok: true, query: 'иванов', groups: [] });
});

/**
 * Поиск палитры (`У-75`) — тонкий переходник. Проверяем ровно то, ради чего он
 * написан: сессия обязательна, и решение о видимости принимает общий сервис.
 */
describe('paletteSearchAction (У-75)', () => {
  it('без сессии в сервис не заходит', async () => {
    requireSession.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(paletteSearchAction('иванов')).rejects.toThrow();
    expect(globalSearch).not.toHaveBeenCalled();
  });

  it('зовёт общий сервис поиска с сессией вызывающего', async () => {
    await paletteSearchAction('иванов');
    expect(globalSearch).toHaveBeenCalledWith({}, SESSION, { q: 'иванов' });
  });

  it('признак «вся компания» передаётся только когда он запрошен', async () => {
    await paletteSearchAction('иванов', true);
    expect(globalSearch).toHaveBeenCalledWith({}, SESSION, {
      q: 'иванов',
      teamModeOverride: true,
    });

    globalSearch.mockClear();
    await paletteSearchAction('иванов', false);
    expect(globalSearch).toHaveBeenCalledWith({}, SESSION, { q: 'иванов' });
  });

  it('ответ сервиса возвращается как есть — своих отказов действие не выдумывает', async () => {
    globalSearch.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(paletteSearchAction('иванов')).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});
