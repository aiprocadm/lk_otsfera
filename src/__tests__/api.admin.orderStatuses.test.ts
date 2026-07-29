/**
 * §10 ТЗ v0.5 (этап 2, PR-2) — роуты справочника статусов.
 *
 * Роут — тонкий: гейт + маппинг кода ошибки в HTTP (§3 CLAUDE.md). Здесь и
 * проверяется ровно это, вся логика — в сервисе (его тесты отдельно).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, requireFieldsAdmin } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireFieldsAdmin: vi.fn()
}));
vi.mock('@/lib/auth/guard', () => ({ requireSession, requireFieldsAdmin }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { createStatusDefinition, updateStatusDefinition, deleteStatusDefinition } = vi.hoisted(
  () => ({
    createStatusDefinition: vi.fn(),
    updateStatusDefinition: vi.fn(),
    deleteStatusDefinition: vi.fn()
  })
);
vi.mock('@/lib/services/orderStatuses', () => ({
  createStatusDefinition,
  updateStatusDefinition,
  deleteStatusDefinition
}));

import { POST } from '@/app/api/admin/order-statuses/route';
import { PATCH, DELETE } from '@/app/api/admin/order-statuses/[id]/route';

const SESSION = { sub: 'a1', role: 'admin' };
const ctx = { params: Promise.resolve({ id: 'st1' }) };

function jsonReq(body: unknown) {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  requireSession.mockReset().mockResolvedValue({ ok: true, value: SESSION });
  requireFieldsAdmin.mockReset().mockReturnValue({ ok: true, value: SESSION });
  createStatusDefinition.mockReset();
  updateStatusDefinition.mockReset();
  deleteStatusDefinition.mockReset();
});

describe('POST /api/admin/order-statuses', () => {
  it('создаёт статус и отдаёт 201', async () => {
    createStatusDefinition.mockResolvedValue({ ok: true, definition: { id: 'st9' } });
    const res = await POST(jsonReq({ key: 'extra', label: 'Доп', sortOrder: 8 }));
    expect(res.status).toBe(201);
    expect(createStatusDefinition).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ key: 'extra', label: 'Доп', sortOrder: 8 })
    );
  });

  it('якорь из тела запроса игнорируется — события раздаёт система', async () => {
    createStatusDefinition.mockResolvedValue({ ok: true, definition: { id: 'st9' } });
    await POST(jsonReq({ key: 'extra', label: 'Доп', anchor: 'paid' }));
    const args = createStatusDefinition.mock.calls[0][2];
    expect(args).not.toHaveProperty('anchor');
  });

  it('неавторизованный запрос отдаёт ответ гарда', async () => {
    requireSession.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(401);
  });

  it('менеджеру — ответ гейта настройки', async () => {
    requireFieldsAdmin.mockReturnValue({ ok: false, response: new Response(null, { status: 403 }) });
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(403);
  });

  it('коды сервиса маппятся в статусы: forbidden→403, not_found→404, прочее→400', async () => {
    for (const [error, status] of [
      ['forbidden', 403],
      ['not_found', 404],
      ['duplicate_key', 400]
    ] as const) {
      createStatusDefinition.mockResolvedValue({ ok: false, error });
      const res = await POST(jsonReq({ key: 'k', label: 'L' }));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error });
    }
  });
});

describe('PATCH /api/admin/order-statuses/[id]', () => {
  it('передаёт название, порядок и активность', async () => {
    updateStatusDefinition.mockResolvedValue({ ok: true, definition: { id: 'st1' } });
    const res = await PATCH(jsonReq({ label: 'Новое', sortOrder: 3, isActive: false }), ctx);
    expect(res.status).toBe(200);
    expect(updateStatusDefinition).toHaveBeenCalledWith({}, SESSION, 'st1', {
      label: 'Новое',
      sortOrder: 3,
      isActive: false
    });
  });

  it('системная защита отдаёт 400 с кодом', async () => {
    updateStatusDefinition.mockResolvedValue({ ok: false, error: 'system_protected' });
    const res = await PATCH(jsonReq({ isActive: false }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'system_protected' });
  });

  it('forbidden от сервиса маппится в 403', async () => {
    updateStatusDefinition.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect((await PATCH(jsonReq({}), ctx)).status).toBe(403);
  });

  it('гарды: 401 без сессии, 403 менеджеру', async () => {
    requireSession.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await PATCH(jsonReq({}), ctx)).status).toBe(401);

    requireSession.mockResolvedValue({ ok: true, value: SESSION });
    requireFieldsAdmin.mockReturnValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await PATCH(jsonReq({}), ctx)).status).toBe(403);
  });
});

describe('DELETE /api/admin/order-statuses/[id]', () => {
  it('удаляет неиспользованную строку', async () => {
    deleteStatusDefinition.mockResolvedValue({ ok: true });
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('использованную и системную удалить нельзя — 400', async () => {
    deleteStatusDefinition.mockResolvedValue({ ok: false, error: 'system_protected' });
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), ctx);
    expect(res.status).toBe(400);
  });

  it('несуществующая строка — 404', async () => {
    deleteStatusDefinition.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), ctx);
    expect(res.status).toBe(404);
  });

  it('гарды: 401 без сессии, 403 менеджеру', async () => {
    requireSession.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await DELETE(new Request('http://x'), ctx)).status).toBe(401);

    requireSession.mockResolvedValue({ ok: true, value: SESSION });
    requireFieldsAdmin.mockReturnValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await DELETE(new Request('http://x'), ctx)).status).toBe(403);
  });
});
