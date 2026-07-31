import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, isRateLimited, suggestParty } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  isRateLimited: vi.fn(),
  suggestParty: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireSession }));
vi.mock('@/lib/rateLimit', () => ({ isRateLimited }));
vi.mock('@/lib/services/dadata/suggestParty', () => ({ suggestParty }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { GET } from '@/app/api/suggest/party/route';

function req(query?: string): Request {
  const url = new URL('https://app.test/api/suggest/party');
  if (query !== undefined) url.searchParams.set('query', query);
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ ok: true, value: { sub: 'user-1', role: 'partner' } });
  isRateLimited.mockResolvedValue(false);
  suggestParty.mockResolvedValue([]);
});

describe('GET /api/suggest/party', () => {
  it('нет сессии → 401 (ответ гарда), без обращения к сервису', async () => {
    requireSession.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const res = await GET(req('сбер'));
    expect(res.status).toBe(401);
    expect(suggestParty).not.toHaveBeenCalled();
  });

  it('rate-limit → 429, ключ лимита содержит id пользователя', async () => {
    isRateLimited.mockResolvedValue(true);
    const res = await GET(req('сбер'));
    expect(res.status).toBe(429);
    expect(isRateLimited).toHaveBeenCalledWith('suggest:party:user-1', expect.anything());
    expect(suggestParty).not.toHaveBeenCalled();
  });

  it('короткий/пустой запрос → пустой список без вызова DaData', async () => {
    expect(await (await GET(req('a'))).json()).toEqual({ suggestions: [] });
    expect(await (await GET(req())).json()).toEqual({ suggestions: [] });
    expect(suggestParty).not.toHaveBeenCalled();
  });

  it('happy path: зовёт сервис с очищенным запросом и отдаёт только suggestions', async () => {
    suggestParty.mockResolvedValue([
      { name: 'Сбербанк', inn: '7707', kpp: null, ogrn: null, address: null },
    ]);
    const res = await GET(req('  сбер  '));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(suggestParty).toHaveBeenCalledWith(expect.anything(), 'сбер');
    expect(body).toEqual({
      suggestions: [{ name: 'Сбербанк', inn: '7707', kpp: null, ogrn: null, address: null }],
    });
    // Ключ DaData в ответе не фигурирует (его формирует и держит сервис).
    expect(JSON.stringify(body)).not.toContain('Token');
  });
});
