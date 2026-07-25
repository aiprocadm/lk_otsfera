import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 5 PR-2 (ФТ-13.4): тонкий роут GET /api/duplicates/by-inn — только
 * склейка сессия → rate-limit → сервис → HTTP-маппинг:
 *  - 401 без сессии (лимитер и сервис не зовутся);
 *  - 429 при rate-limit (ключ duplicates-inn:<sub>, окно 60с/30);
 *  - 403 forbidden / 400 validation из Result-кода сервиса;
 *  - 200 {duplicates} happy: inn из query пробрасывается в сервис как есть.
 */

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { __tag: 'prisma-singleton' } }));
vi.mock('@/lib/rateLimit', () => ({ isRateLimited: vi.fn() }));
vi.mock('@/lib/services/duplicates/findByInn', () => ({ findByInn: vi.fn() }));

import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isRateLimited } from '@/lib/rateLimit';
import { findByInn } from '@/lib/services/duplicates/findByInn';
import { GET } from '@/app/api/duplicates/by-inn/route';

const manager = { sub: 'mgr-1', role: 'manager' } as never;
const req = (inn?: string) =>
  new Request(
    inn === undefined
      ? 'http://x/api/duplicates/by-inn'
      : `http://x/api/duplicates/by-inn?inn=${encodeURIComponent(inn)}`
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isRateLimited).mockResolvedValue(false);
});

describe('GET /api/duplicates/by-inn', () => {
  it('401 без сессии: лимитер и сервис не зовутся', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(req('7707083893'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(vi.mocked(isRateLimited)).not.toHaveBeenCalled();
    expect(vi.mocked(findByInn)).not.toHaveBeenCalled();
  });

  it('429 при rate-limit: ключ duplicates-inn:<sub>, окно 60с/30, сервис не зовётся', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(isRateLimited).mockResolvedValue(true);
    const res = await GET(req('7707083893'));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(vi.mocked(isRateLimited)).toHaveBeenCalledWith('duplicates-inn:mgr-1', {
      windowMs: 60 * 1000,
      max: 30
    });
    expect(vi.mocked(findByInn)).not.toHaveBeenCalled();
  });

  it('403 когда сервис вернул forbidden (клиентская роль)', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'p-1', role: 'partner' } as never);
    vi.mocked(findByInn).mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await GET(req('7707083893'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('400 когда сервис вернул validation', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(findByInn).mockResolvedValue({ ok: false, error: 'validation' });
    const res = await GET(req('123'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'validation' });
  });

  it('200 happy: {duplicates}; prisma/сессия/inn прокинуты в сервис', async () => {
    const duplicates = {
      organizations: [{ id: 'o1', name: 'ООО Ромашка' }],
      leads: [{ id: 'l1', subject: 'Обучение', status: 'new' }]
    };
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(findByInn).mockResolvedValue({ ok: true, duplicates });
    const res = await GET(req('7707083893'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ duplicates });
    expect(vi.mocked(findByInn)).toHaveBeenCalledWith(prisma, manager, { inn: '7707083893' });
  });

  it('inn отсутствует в query → в сервис уходит пустая строка (валидация — его зона)', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(findByInn).mockResolvedValue({ ok: false, error: 'validation' });
    const res = await GET(req());
    expect(res.status).toBe(400);
    expect(vi.mocked(findByInn)).toHaveBeenCalledWith(prisma, manager, { inn: '' });
  });
});
