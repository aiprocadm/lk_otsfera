/**
 * Добор покрытия по роутам направлений обучения (админский кабинет):
 *   src/app/api/admin/training-directions/route.ts
 *   src/app/api/admin/training-directions/[id]/route.ts
 *
 * Закрываем ветки, которых не было в api.admin.trainingDirections.test.ts:
 *  - `mapErr` в route.ts: код `not_found` → 404 (и ошибочный путь GET вообще);
 *  - условные спреды `slug`/`sortOrder` в POST (exactOptionalPropertyTypes:
 *    «ключа нет» ≠ «ключ = undefined»);
 *  - `mapErr` в [id]/route.ts: незнакомый код ошибки → 400;
 *  - условные спреды `name`/`sortOrder` в PATCH.
 *
 * Отдельный файл (а не правка существующего) — чтобы не конфликтовать с
 * параллельной работой по тем же тест-файлам.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, requireAdmin } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireAdmin: vi.fn(),
}));
const { createDirection, listDirections, updateDirection, deactivateDirection } = vi.hoisted(
  () => ({
    createDirection: vi.fn(),
    listDirections: vi.fn(),
    updateDirection: vi.fn(),
    deactivateDirection: vi.fn(),
  })
);

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireAdmin }));
vi.mock('@/lib/services/training', () => ({
  createDirection,
  listDirections,
  updateDirection,
  deactivateDirection,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { GET, POST } from '@/app/api/admin/training-directions/route';
import { PATCH, DELETE } from '@/app/api/admin/training-directions/[id]/route';

const adminSession = { sub: 'admin-1', role: 'admin' };

const routeCtx = { params: Promise.resolve({}) };
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const jsonReq = (method: string, body: unknown) =>
  new Request('http://x', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ ok: true, value: adminSession });
  requireAdmin.mockReturnValue({ ok: true, value: adminSession });
});

// ─── GET /api/admin/training-directions ──────────────────────────────────────

describe('GET /api/admin/training-directions — ошибки сервиса', () => {
  it('200 и список направлений, включая выключенные', async () => {
    listDirections.mockResolvedValue({
      ok: true,
      directions: [{ id: 'd1', name: 'IT', isActive: false }],
    });
    const res = await GET(new Request('http://x'), routeCtx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      directions: [{ id: 'd1', name: 'IT', isActive: false }],
    });
    expect(listDirections).toHaveBeenCalledWith({}, adminSession, { includeInactive: true });
  });

  it('404 и код not_found в теле, если сервис вернул not_found', async () => {
    listDirections.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await GET(new Request('http://x'), routeCtx);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('400 и исходный код в теле для незнакомой ошибки сервиса', async () => {
    listDirections.mockResolvedValue({ ok: false, error: 'validation' });
    const res = await GET(new Request('http://x'), routeCtx);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'validation' });
  });
});

// ─── POST /api/admin/training-directions ─────────────────────────────────────

describe('POST /api/admin/training-directions — необязательные поля', () => {
  it('передаёт slug и sortOrder в сервис, когда они пришли в теле', async () => {
    createDirection.mockResolvedValue({
      ok: true,
      direction: { id: 'd9', name: 'Охрана труда', slug: 'ot', sortOrder: 5 },
    });
    const res = await POST(
      jsonReq('POST', { name: 'Охрана труда', slug: 'ot', sortOrder: 5 }),
      routeCtx
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      direction: { id: 'd9', name: 'Охрана труда', slug: 'ot', sortOrder: 5 },
    });
    expect(createDirection).toHaveBeenCalledWith({}, adminSession, {
      name: 'Охрана труда',
      slug: 'ot',
      sortOrder: 5,
    });
  });

  it('не подставляет ключи slug/sortOrder, если их нет в теле', async () => {
    createDirection.mockResolvedValue({ ok: true, direction: { id: 'd10', name: 'ПБ' } });
    const res = await POST(jsonReq('POST', { name: 'ПБ' }), routeCtx);
    expect(res.status).toBe(201);
    const args = createDirection.mock.calls[0][2];
    expect(Object.keys(args).sort()).toEqual(['name']);
  });

  it('404, если сервис вернул not_found', async () => {
    createDirection.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await POST(jsonReq('POST', { name: 'X' }), routeCtx);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('403 и код forbidden в теле, если сервис отказал по правам', async () => {
    createDirection.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await POST(jsonReq('POST', { name: 'X' }), routeCtx);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
  });
});

// ─── PATCH /api/admin/training-directions/[id] ───────────────────────────────

describe('PATCH /api/admin/training-directions/[id] — поля патча и коды ошибок', () => {
  it('передаёт id из сегмента пути вместе с name и sortOrder', async () => {
    updateDirection.mockResolvedValue({
      ok: true,
      direction: { id: 'd1', name: 'Новое', sortOrder: 3 },
    });
    const res = await PATCH(jsonReq('PATCH', { name: 'Новое', sortOrder: 3 }), idCtx('d1'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      direction: { id: 'd1', name: 'Новое', sortOrder: 3 },
    });
    expect(updateDirection).toHaveBeenCalledWith({}, adminSession, {
      id: 'd1',
      name: 'Новое',
      sortOrder: 3,
    });
  });

  it('при пустом теле шлёт сервису только id (ключей name/sortOrder нет)', async () => {
    updateDirection.mockResolvedValue({ ok: true, direction: { id: 'd2' } });
    const res = await PATCH(jsonReq('PATCH', {}), idCtx('d2'));
    expect(res.status).toBe(200);
    const args = updateDirection.mock.calls[0][2];
    expect(Object.keys(args).sort()).toEqual(['id']);
  });

  it('передаёт только sortOrder, когда name в теле нет', async () => {
    updateDirection.mockResolvedValue({ ok: true, direction: { id: 'd3', sortOrder: 7 } });
    const res = await PATCH(jsonReq('PATCH', { sortOrder: 7 }), idCtx('d3'));
    expect(res.status).toBe(200);
    const args = updateDirection.mock.calls[0][2];
    expect(Object.keys(args).sort()).toEqual(['id', 'sortOrder']);
    expect(args.sortOrder).toBe(7);
  });

  it('404 и код not_found в теле для отсутствующего направления', async () => {
    updateDirection.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await PATCH(jsonReq('PATCH', { name: 'X' }), idCtx('missing'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('400 и исходный код в теле для незнакомой ошибки сервиса', async () => {
    updateDirection.mockResolvedValue({ ok: false, error: 'validation' });
    const res = await PATCH(jsonReq('PATCH', { name: '' }), idCtx('d1'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'validation' });
  });
});

// ─── DELETE /api/admin/training-directions/[id] ──────────────────────────────

describe('DELETE /api/admin/training-directions/[id] — коды ошибок', () => {
  it('200 и выключенное направление в теле при успешной деактивации', async () => {
    deactivateDirection.mockResolvedValue({ ok: true, direction: { id: 'd5', isActive: false } });
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), idCtx('d5'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ direction: { id: 'd5', isActive: false } });
    expect(deactivateDirection).toHaveBeenCalledWith({}, adminSession, { id: 'd5' });
  });

  it('403, если сервис вернул forbidden, и деактивации не было', async () => {
    deactivateDirection.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), idCtx('d1'));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
    expect(deactivateDirection).toHaveBeenCalledWith({}, adminSession, { id: 'd1' });
  });

  it('400 для незнакомого кода ошибки сервиса', async () => {
    deactivateDirection.mockResolvedValue({ ok: false, error: 'has_dependencies' });
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), idCtx('d4'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'has_dependencies' });
  });
});
