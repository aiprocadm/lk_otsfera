import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Перенаправления за посредником (найдено сухим прогоном приёмки 17.10.2026,
 * этап 8 программы ПМ). За nginx Next.js собирает `req.url` на своём имени
 * `localhost:3000`, и перенаправление уходило на `https://localhost:3000/…` —
 * живой пользователь терял сайт при истёкшей сессии или переходе на
 * «/dashboard». Адрес строится от имени, которое передал посредник; кривое
 * значение шапки — откат к `req.url`, а не адрес злоумышленника.
 */
vi.mock('@/lib/logging/edge', () => ({ edgeLog: { error: vi.fn(), warn: vi.fn() } }));

import { middleware } from '@/middleware';

const ORIGINAL = process.env.JWT_SECRET;
beforeEach(() => {
  process.env.JWT_SECRET = 'x'.repeat(40);
});
afterEach(() => {
  process.env.JWT_SECRET = ORIGINAL;
});

/** Запрос без сессии на защищённый адрес — его всегда уводят на вход. */
function req(headers: Record<string, string>) {
  return {
    url: 'http://localhost:3000/manager/orders',
    nextUrl: { pathname: '/manager/orders', protocol: 'http:' },
    headers: new Headers(headers),
    cookies: { get: vi.fn().mockReturnValue(undefined) },
  } as never;
}

const location = async (headers: Record<string, string>) =>
  (await middleware(req(headers))).headers.get('location');

describe('middleware — перенаправление за посредником', () => {
  it('имя сайта и схема от посредника — человек остаётся на своём сайте', async () => {
    expect(
      await location({
        host: 'lk.ptsfera.online',
        'x-forwarded-host': 'lk.ptsfera.online',
        'x-forwarded-proto': 'https',
      })
    ).toBe('https://lk.ptsfera.online/login');
  });

  it('несколько посредников — берётся первое имя и первая схема', async () => {
    expect(
      await location({
        'x-forwarded-host': 'lk.ptsfera.online, inner',
        'x-forwarded-proto': 'https, http',
      })
    ).toBe('https://lk.ptsfera.online/login');
  });

  it('только Host без схемы — схема запроса', async () => {
    expect(await location({ host: '127.0.0.1:3000' })).toBe('http://127.0.0.1:3000/login');
  });

  it('кривое имя или чужая схема — откат к адресу запроса, а не к «злому» адресу', async () => {
    expect(await location({ host: 'evil.com/phish?x=' })).toBe('http://localhost:3000/login');
    expect(await location({ host: 'lk.ptsfera.online', 'x-forwarded-proto': 'javascript' })).toBe(
      'http://localhost:3000/login'
    );
    expect(await location({})).toBe('http://localhost:3000/login');
  });
});
