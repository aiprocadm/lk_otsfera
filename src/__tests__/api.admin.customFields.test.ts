import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, requireFieldsAdmin } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireFieldsAdmin: vi.fn(),
}));
const { createDefinition, updateDefinition, deactivateDefinition } = vi.hoisted(() => ({
  createDefinition: vi.fn(),
  updateDefinition: vi.fn(),
  deactivateDefinition: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireFieldsAdmin }));
vi.mock('@/lib/services/customFields', () => ({
  createDefinition,
  updateDefinition,
  deactivateDefinition,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/admin/custom-fields/route';
import { PATCH, DELETE } from '@/app/api/admin/custom-fields/[id]/route';

const adminSession = { sub: 'admin-1', role: 'admin' };

function idCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ ok: true, value: adminSession });
  requireFieldsAdmin.mockReturnValue({ ok: true, value: adminSession });
});

// ─── POST /api/admin/custom-fields ───────────────────────────────────────────

describe('POST /api/admin/custom-fields', () => {
  it('201 при успехе', async () => {
    createDefinition.mockResolvedValue({ ok: true, definition: { id: 'cf1', key: 'field_one' } });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        entityType: 'order',
        key: 'field_one',
        label: 'Поле',
        fieldType: 'text',
      }),
    });
    const res = await POST(req as Request);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.definition.id).toBe('cf1');
    expect(requireFieldsAdmin).toHaveBeenCalled();
  });

  it('403 если сервис вернул forbidden', async () => {
    createDefinition.mockResolvedValue({ ok: false, error: 'forbidden' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'order', key: 'x', label: 'X', fieldType: 'text' }),
    });
    const res = await POST(req as Request);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('forbidden');
  });

  it('400 если сервис вернул invalid_key', async () => {
    createDefinition.mockResolvedValue({ ok: false, error: 'invalid_key' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'order', key: '123bad', label: 'X', fieldType: 'text' }),
    });
    const res = await POST(req as Request);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_key');
  });

  it('400 если сервис вернул options_required', async () => {
    createDefinition.mockResolvedValue({ ok: false, error: 'options_required' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        entityType: 'order',
        key: 'sel',
        label: 'Выбор',
        fieldType: 'select',
      }),
    });
    const res = await POST(req as Request);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('options_required');
  });

  it('400 если сервис вернул duplicate_key', async () => {
    createDefinition.mockResolvedValue({ ok: false, error: 'duplicate_key' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'order', key: 'dup', label: 'Дубль', fieldType: 'text' }),
    });
    const res = await POST(req as Request);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('duplicate_key');
  });

  it('401 если нет сессии', async () => {
    requireSession.mockResolvedValue({
      ok: false,
      response: new Response('Unauthorized', { status: 401 }),
    });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'order', key: 'x', label: 'X', fieldType: 'text' }),
    });
    const res = await POST(req as Request);
    expect(res.status).toBe(401);
    expect(createDefinition).not.toHaveBeenCalled();
  });

  it('403 если не admin (guard)', async () => {
    requireFieldsAdmin.mockReturnValue({
      ok: false,
      response: new Response('Forbidden', { status: 403 }),
    });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'order', key: 'x', label: 'X', fieldType: 'text' }),
    });
    const res = await POST(req as Request);
    expect(res.status).toBe(403);
    expect(createDefinition).not.toHaveBeenCalled();
  });
});

// ─── PATCH /api/admin/custom-fields/[id] ─────────────────────────────────────

describe('PATCH /api/admin/custom-fields/[id]', () => {
  it('200 при успехе', async () => {
    updateDefinition.mockResolvedValue({ ok: true, definition: { id: 'cf1', label: 'Обновлено' } });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ label: 'Обновлено' }),
    });
    const res = await PATCH(req as Request, idCtx('cf1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.definition.label).toBe('Обновлено');
  });

  it('404 если not_found', async () => {
    updateDefinition.mockResolvedValue({ ok: false, error: 'not_found' });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ label: 'X' }),
    });
    const res = await PATCH(req as Request, idCtx('missing'));
    expect(res.status).toBe(404);
  });

  it('403 если forbidden', async () => {
    updateDefinition.mockResolvedValue({ ok: false, error: 'forbidden' });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ label: 'X' }),
    });
    const res = await PATCH(req as Request, idCtx('cf1'));
    expect(res.status).toBe(403);
  });

  it('401 если нет сессии', async () => {
    requireSession.mockResolvedValue({
      ok: false,
      response: new Response('Unauthorized', { status: 401 }),
    });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ label: 'X' }),
    });
    const res = await PATCH(req as Request, idCtx('cf1'));
    expect(res.status).toBe(401);
    expect(updateDefinition).not.toHaveBeenCalled();
  });
});

// ─── DELETE /api/admin/custom-fields/[id] ────────────────────────────────────

describe('DELETE /api/admin/custom-fields/[id]', () => {
  it('200 при успехе', async () => {
    deactivateDefinition.mockResolvedValue({
      ok: true,
      definition: { id: 'cf1', isActive: false },
    });
    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as Request, idCtx('cf1'));
    expect(res.status).toBe(200);
  });

  it('404 если not_found', async () => {
    deactivateDefinition.mockResolvedValue({ ok: false, error: 'not_found' });
    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as Request, idCtx('missing'));
    expect(res.status).toBe(404);
  });

  it('403 если forbidden', async () => {
    deactivateDefinition.mockResolvedValue({ ok: false, error: 'forbidden' });
    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as Request, idCtx('cf1'));
    expect(res.status).toBe(403);
  });

  it('401 если нет сессии', async () => {
    requireSession.mockResolvedValue({
      ok: false,
      response: new Response('Unauthorized', { status: 401 }),
    });
    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as Request, idCtx('cf1'));
    expect(res.status).toBe(401);
    expect(deactivateDefinition).not.toHaveBeenCalled();
  });
});
