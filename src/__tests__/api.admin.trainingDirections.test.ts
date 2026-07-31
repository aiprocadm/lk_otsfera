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

function idCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ ok: true, value: adminSession });
  requireAdmin.mockReturnValue({ ok: true, value: adminSession });
});

// ─── GET /api/admin/training-directions ──────────────────────────────────────

describe('GET /api/admin/training-directions', () => {
  it('200 с массивом направлений', async () => {
    listDirections.mockResolvedValue({ ok: true, directions: [{ id: 'd1', name: 'IT' }] });
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.directions).toHaveLength(1);
    expect(requireAdmin).toHaveBeenCalled();
  });

  it('401 если нет сессии', async () => {
    requireSession.mockResolvedValue({
      ok: false,
      response: new Response('Unauthorized', { status: 401 }),
    });
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(401);
    expect(listDirections).not.toHaveBeenCalled();
  });

  it('403 если не admin', async () => {
    requireAdmin.mockReturnValue({
      ok: false,
      response: new Response('Forbidden', { status: 403 }),
    });
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(403);
    expect(listDirections).not.toHaveBeenCalled();
  });
});

// ─── POST /api/admin/training-directions ─────────────────────────────────────

describe('POST /api/admin/training-directions', () => {
  it('403 если сервис вернул forbidden', async () => {
    createDirection.mockResolvedValue({ ok: false, error: 'forbidden' });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'X' }) });
    const res = await POST(req as Request);
    expect(res.status).toBe(403);
  });

  it('400 если сервис вернул validation', async () => {
    createDirection.mockResolvedValue({ ok: false, error: 'validation' });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ name: '' }) });
    const res = await POST(req as Request);
    expect(res.status).toBe(400);
  });

  it('201 при успехе', async () => {
    createDirection.mockResolvedValue({ ok: true, direction: { id: 'd1', name: 'IT' } });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'IT' }) });
    const res = await POST(req as Request);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.direction.id).toBe('d1');
  });

  it('401 если нет сессии', async () => {
    requireSession.mockResolvedValue({
      ok: false,
      response: new Response('Unauthorized', { status: 401 }),
    });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'X' }) });
    const res = await POST(req as Request);
    expect(res.status).toBe(401);
    expect(createDirection).not.toHaveBeenCalled();
  });
});

// ─── PATCH /api/admin/training-directions/[id] ───────────────────────────────

describe('PATCH /api/admin/training-directions/[id]', () => {
  it('200 при успехе', async () => {
    updateDirection.mockResolvedValue({ ok: true, direction: { id: 'd1', name: 'Updated' } });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    });
    const res = await PATCH(req as Request, idCtx('d1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.direction.name).toBe('Updated');
  });

  it('404 если not_found', async () => {
    updateDirection.mockResolvedValue({ ok: false, error: 'not_found' });
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'X' }) });
    const res = await PATCH(req as Request, idCtx('missing'));
    expect(res.status).toBe(404);
  });

  it('403 если forbidden', async () => {
    updateDirection.mockResolvedValue({ ok: false, error: 'forbidden' });
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'X' }) });
    const res = await PATCH(req as Request, idCtx('d1'));
    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/admin/training-directions/[id] ──────────────────────────────

describe('DELETE /api/admin/training-directions/[id]', () => {
  it('200 при успехе', async () => {
    deactivateDirection.mockResolvedValue({ ok: true, direction: { id: 'd1', isActive: false } });
    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as Request, idCtx('d1'));
    expect(res.status).toBe(200);
  });

  it('404 если not_found', async () => {
    deactivateDirection.mockResolvedValue({ ok: false, error: 'not_found' });
    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as Request, idCtx('missing'));
    expect(res.status).toBe(404);
  });

  it('401 если нет сессии', async () => {
    requireSession.mockResolvedValue({
      ok: false,
      response: new Response('Unauthorized', { status: 401 }),
    });
    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as Request, idCtx('d1'));
    expect(res.status).toBe(401);
    expect(deactivateDirection).not.toHaveBeenCalled();
  });
});
