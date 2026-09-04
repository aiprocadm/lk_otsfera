import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * `У-173` — GET /api/integrations/1c/documents/export: скачать пакет
 * документов для 1С. Роут тонкий: право раздела → фильтр из адреса →
 * сервис → код в HTTP-статус. Граница компании — в сервисе, тут только
 * проверяем, что его отказ не превращается в файл.
 */
const { getSession, canAccessSettingsSection, buildExportPackage } = vi.hoisted(() => ({
  getSession: vi.fn(),
  canAccessSettingsSection: vi.fn(),
  buildExportPackage: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/auth/settingsAccess', () => ({ canAccessSettingsSection }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/oneCSync/exportPackage', async (orig) => {
  const actual = await orig<typeof import('@/lib/services/oneCSync/exportPackage')>();
  return { ...actual, buildExportPackage };
});

import { GET } from '@/app/api/integrations/1c/documents/export/route';

const admin = { sub: 'a1', role: 'admin' } as never;
const leader = { sub: 'l1', role: 'leader', companyId: 'co-1' } as never;

function req(query: Record<string, string> = {}): NextRequest {
  const url = new URL('https://app.test/api/integrations/1c/documents/export');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  canAccessSettingsSection.mockReturnValue(true);
  buildExportPackage.mockResolvedValue({
    ok: true,
    zip: Buffer.from('PK-stub'),
    fileName: '1c-documents-2026-09-04.zip',
    count: 3,
    skipped: [{ documentId: 'd-9', number: null, reason: 'no_number' }],
  });
});

describe('GET /api/integrations/1c/documents/export (У-173)', () => {
  it('без сессии — 401, сервис не тронут', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(buildExportPackage).not.toHaveBeenCalled();
  });

  it('нет права на раздел «Обмен с 1С» — 403 (default-deny профиль, не роль)', async () => {
    getSession.mockResolvedValue(leader);
    canAccessSettingsSection.mockReturnValue(false);
    const res = await GET(req());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
    expect(canAccessSettingsSection).toHaveBeenCalledWith(
      leader,
      expect.objectContaining({ id: 'integrations.oneC' })
    );
    expect(buildExportPackage).not.toHaveBeenCalled();
  });

  it('фильтр из адреса разбирается и уходит в сервис; ответ — ZIP на скачивание', async () => {
    getSession.mockResolvedValue(admin);
    const res = await GET(
      req({ from: '2026-09-01', to: '2026-09-03', type: 'act', oneCPushStatus: 'failed' })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="1c-documents-2026-09-04.zip"'
    );
    expect(res.headers.get('x-documents-count')).toBe('3');
    expect(res.headers.get('x-documents-skipped')).toBe('1');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('PK-stub');
    expect(buildExportPackage).toHaveBeenCalledWith({}, admin, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-03T00:00:00Z'),
      type: 'act',
      oneCPushStatus: 'failed',
    });
  });

  it('без параметров — фильтр пустой (чужие слова тоже не ломают запрос)', async () => {
    getSession.mockResolvedValue(admin);
    await GET(req({ type: 'commercial_proposal' }));
    expect(buildExportPackage).toHaveBeenCalledWith({}, admin, {
      from: undefined,
      to: undefined,
      type: undefined,
      oneCPushStatus: undefined,
    });
  });

  it('отказ сервиса forbidden (менеджер без компании) — 403', async () => {
    getSession.mockResolvedValue(leader);
    buildExportPackage.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await GET(req());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('выгружать нечего — 404 empty, а не пустой архив', async () => {
    getSession.mockResolvedValue(admin);
    buildExportPackage.mockResolvedValue({ ok: false, error: 'empty' });
    const res = await GET(req());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'empty' });
  });
});
