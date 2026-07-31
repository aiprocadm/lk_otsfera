import { beforeEach, describe, expect, it, vi } from 'vitest';

// Real guard (requireManager from @/lib/auth/requireRole) calls getSession() internally,
// so we mock the session loader + next/navigation, matching the exemplar
// api.manager.documents.upload.test.ts pattern.
const { getSession, redirectMock } = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
}));

const { addOrderItem, listOrderItems, updateItemStatus, removeOrderItem } = vi.hoisted(() => ({
  addOrderItem: vi.fn(),
  listOrderItems: vi.fn(),
  updateItemStatus: vi.fn(),
  removeOrderItem: vi.fn(),
}));

const { createCertificate, issueFromOrderItem } = vi.hoisted(() => ({
  createCertificate: vi.fn(),
  issueFromOrderItem: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  notFound: () => {
    throw new Error('NOTFOUND');
  },
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/services/training/orderItems', () => ({
  addOrderItem,
  listOrderItems,
  updateItemStatus,
  removeOrderItem,
}));
vi.mock('@/lib/services/training/certificates', () => ({
  createCertificate,
  issueFromOrderItem,
}));

import { GET, POST } from '@/app/api/manager/orders/[id]/items/route';
import { PATCH, DELETE } from '@/app/api/manager/order-items/[id]/route';
import { POST as certPost } from '@/app/api/manager/certificates/route';
import { notFoundIfDisabled } from '@/lib/featureFlags';

function managerSession(opts: { sub?: string; managedOrgIds?: string[] } = {}) {
  return {
    sub: opts.sub ?? 'u-mgr-1',
    role: 'manager',
    email: 'mgr@local',
    managedOrgIds: opts.managedOrgIds ?? ['org-a'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(managerSession());
  vi.mocked(notFoundIfDisabled).mockReturnValue(undefined as never);
});

// ── manager_cabinet feature-flag gate ─────────────────────────────────────────

describe('manager_cabinet flag disabled → 404 before handler logic', () => {
  beforeEach(() => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(
      new Response('Not Found', { status: 404 }) as never
    );
  });

  it('GET /orders/[id]/items → 404, service untouched', async () => {
    const res = await GET(
      new Request('http://x') as never,
      { params: Promise.resolve({ id: 'o1' }) } as never
    );
    expect(res.status).toBe(404);
    expect(listOrderItems).not.toHaveBeenCalled();
  });

  it('POST /orders/[id]/items → 404, service untouched', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ studentId: 's1', directionId: 'd1' }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: 'o1' }) } as never);
    expect(res.status).toBe(404);
    expect(addOrderItem).not.toHaveBeenCalled();
  });

  it('PATCH /order-items/[id] → 404, service untouched', async () => {
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ trainingStatus: 'completed' }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: 'it1' }) } as never);
    expect(res.status).toBe(404);
    expect(updateItemStatus).not.toHaveBeenCalled();
  });

  it('DELETE /order-items/[id] → 404, service untouched', async () => {
    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: 'it1' }) } as never);
    expect(res.status).toBe(404);
    expect(removeOrderItem).not.toHaveBeenCalled();
  });

  it('POST /certificates → 404, service untouched', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ orderItemId: 'oi1', number: 'X', issuedAt: '2026-01-01' }),
    });
    const res = await certPost(req as never);
    expect(res.status).toBe(404);
    expect(issueFromOrderItem).not.toHaveBeenCalled();
    expect(createCertificate).not.toHaveBeenCalled();
  });
});

// ── GET /api/manager/orders/[id]/items ────────────────────────────────────────

describe('GET /api/manager/orders/[id]/items', () => {
  it('200 with items on success', async () => {
    listOrderItems.mockResolvedValue({ ok: true, items: [{ id: 'it1' }] });
    const req = new Request('http://x');
    const res = await GET(req as never, { params: Promise.resolve({ id: 'o1' }) } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[] };
    expect(body.items).toHaveLength(1);
  });

  it('403 forbidden', async () => {
    listOrderItems.mockResolvedValue({ ok: false, error: 'forbidden' });
    const req = new Request('http://x');
    const res = await GET(req as never, { params: Promise.resolve({ id: 'o1' }) } as never);
    expect(res.status).toBe(403);
  });

  it('404 not_found', async () => {
    listOrderItems.mockResolvedValue({ ok: false, error: 'not_found' });
    const req = new Request('http://x');
    const res = await GET(req as never, { params: Promise.resolve({ id: 'o1' }) } as never);
    expect(res.status).toBe(404);
  });

  it('redirects non-manager to /forbidden', async () => {
    getSession.mockResolvedValue({ sub: 'u-admin', role: 'admin', email: 'a@local' });
    const req = new Request('http://x');
    await expect(
      GET(req as never, { params: Promise.resolve({ id: 'o1' }) } as never)
    ).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/forbidden');
  });
});

// ── POST /api/manager/orders/[id]/items ───────────────────────────────────────

describe('POST /api/manager/orders/[id]/items', () => {
  it('409 на дубль позиции', async () => {
    addOrderItem.mockResolvedValue({ ok: false, error: 'duplicate_position' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ studentId: 's1', directionId: 'd1' }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: 'o1' }) } as never);
    expect(res.status).toBe(409);
  });

  it('201 при успехе', async () => {
    addOrderItem.mockResolvedValue({ ok: true, item: { id: 'it1' } });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ studentId: 's1', directionId: 'd1' }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: 'o1' }) } as never);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { id: string } };
    expect(body.item).toEqual({ id: 'it1' });
  });

  it('400 direction_inactive', async () => {
    addOrderItem.mockResolvedValue({ ok: false, error: 'direction_inactive' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ studentId: 's1', directionId: 'd1' }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: 'o1' }) } as never);
    expect(res.status).toBe(400);
  });

  it('400 student_mismatch', async () => {
    addOrderItem.mockResolvedValue({ ok: false, error: 'student_mismatch' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ studentId: 's1', directionId: 'd1' }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: 'o1' }) } as never);
    expect(res.status).toBe(400);
  });

  it('403 forbidden', async () => {
    addOrderItem.mockResolvedValue({ ok: false, error: 'forbidden' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ studentId: 's1', directionId: 'd1' }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: 'o1' }) } as never);
    expect(res.status).toBe(403);
  });

  it('404 not_found', async () => {
    addOrderItem.mockResolvedValue({ ok: false, error: 'not_found' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ studentId: 's1', directionId: 'd1' }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ id: 'o1' }) } as never);
    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/manager/order-items/[id] ──────────────────────────────────────

describe('PATCH /api/manager/order-items/[id]', () => {
  it('200 при успехе', async () => {
    updateItemStatus.mockResolvedValue({ ok: true, item: { id: 'it1' } });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ trainingStatus: 'completed' }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: 'it1' }) } as never);
    expect(res.status).toBe(200);
  });

  it('404 not_found', async () => {
    updateItemStatus.mockResolvedValue({ ok: false, error: 'not_found' });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ trainingStatus: 'completed' }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: 'it1' }) } as never);
    expect(res.status).toBe(404);
  });

  it('403 forbidden', async () => {
    updateItemStatus.mockResolvedValue({ ok: false, error: 'forbidden' });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ trainingStatus: 'completed' }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: 'it1' }) } as never);
    expect(res.status).toBe(403);
  });

  it('redirects non-manager', async () => {
    getSession.mockResolvedValue({ sub: 'u-admin', role: 'admin', email: 'a@local' });
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ trainingStatus: 'completed' }),
    });
    await expect(
      PATCH(req as never, { params: Promise.resolve({ id: 'it1' }) } as never)
    ).rejects.toThrow('REDIRECT');
  });
});

// ── DELETE /api/manager/order-items/[id] ─────────────────────────────────────

describe('DELETE /api/manager/order-items/[id]', () => {
  it('200 при успехе', async () => {
    removeOrderItem.mockResolvedValue({ ok: true, removed: true });
    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: 'it1' }) } as never);
    expect(res.status).toBe(200);
  });

  it('404 not_found', async () => {
    removeOrderItem.mockResolvedValue({ ok: false, error: 'not_found' });
    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: 'it1' }) } as never);
    expect(res.status).toBe(404);
  });

  it('403 forbidden', async () => {
    removeOrderItem.mockResolvedValue({ ok: false, error: 'forbidden' });
    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: 'it1' }) } as never);
    expect(res.status).toBe(403);
  });
});

// ── POST /api/manager/certificates ───────────────────────────────────────────

describe('POST /api/manager/certificates', () => {
  it('201 issueFromOrderItem когда есть orderItemId', async () => {
    issueFromOrderItem.mockResolvedValue({ ok: true, certificate: { id: 'c1' } });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        orderItemId: 'oi1',
        number: 'CERT-001',
        issuedAt: '2026-01-01',
      }),
    });
    const res = await certPost(req as never);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { certificate: { id: string } };
    expect(body.certificate).toEqual({ id: 'c1' });
    expect(issueFromOrderItem).toHaveBeenCalledTimes(1);
    expect(createCertificate).not.toHaveBeenCalled();
  });

  it('201 createCertificate когда нет orderItemId', async () => {
    createCertificate.mockResolvedValue({ ok: true, certificate: { id: 'c2' } });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        studentId: 's1',
        directionId: 'd1',
        number: 'CERT-002',
        issuedAt: '2026-01-01',
      }),
    });
    const res = await certPost(req as never);
    expect(res.status).toBe(201);
    expect(createCertificate).toHaveBeenCalledTimes(1);
    expect(issueFromOrderItem).not.toHaveBeenCalled();
  });

  it('400 без orderItemId/studentId/directionId — сервис не вызывается', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ number: 'CERT-003', issuedAt: '2026-01-01' }),
    });
    const res = await certPost(req as never);
    expect(res.status).toBe(400);
    expect(createCertificate).not.toHaveBeenCalled();
    expect(issueFromOrderItem).not.toHaveBeenCalled();
  });

  it('400 validation error', async () => {
    createCertificate.mockResolvedValue({ ok: false, error: 'validation' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        studentId: 's1',
        directionId: 'd1',
        number: '',
        issuedAt: '2026-01-01',
      }),
    });
    const res = await certPost(req as never);
    expect(res.status).toBe(400);
  });

  it('403 forbidden', async () => {
    issueFromOrderItem.mockResolvedValue({ ok: false, error: 'forbidden' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ orderItemId: 'oi1', number: 'X', issuedAt: '2026-01-01' }),
    });
    const res = await certPost(req as never);
    expect(res.status).toBe(403);
  });

  it('404 not_found для issueFromOrderItem', async () => {
    issueFromOrderItem.mockResolvedValue({ ok: false, error: 'not_found' });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ orderItemId: 'oi-missing', number: 'X', issuedAt: '2026-01-01' }),
    });
    const res = await certPost(req as never);
    expect(res.status).toBe(404);
  });

  it('redirects non-manager', async () => {
    getSession.mockResolvedValue({
      sub: 'u-partner',
      role: 'partner',
      email: 'p@local',
      partnerId: 'p1',
    });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ orderItemId: 'oi1', number: 'X', issuedAt: '2026-01-01' }),
    });
    await expect(certPost(req as never)).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/forbidden');
  });
});
