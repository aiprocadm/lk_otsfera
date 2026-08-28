import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, documentFindUnique, commentCount, auditCreate, createSignedUrl, redirectMock } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    documentFindUnique: vi.fn(),
    commentCount: vi.fn().mockResolvedValue(0),
    auditCreate: vi.fn(),
    createSignedUrl: vi.fn(),
    redirectMock: vi.fn(() => {
      throw new Error('REDIRECT');
    }),
  }));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  notFound: () => {
    throw new Error('NOTFOUND');
  },
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    document: { findUnique: documentFindUnique },
    comment: { count: commentCount },
    auditLog: { create: auditCreate },
  },
}));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    createSignedUrl,
    upload: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
  }),
}));

import { POST as downloadGet } from '@/app/api/manager/documents/[id]/download/route';

function managerSession(opts: { sub?: string; managedOrgIds?: string[] }) {
  return {
    sub: opts.sub ?? 'u-mgr-1',
    role: 'manager',
    email: 'mgr@local',
    managedOrgIds: opts.managedOrgIds ?? [],
  };
}

function getReq(): Request {
  return new Request('https://app.local/api/manager/documents/d1/download', {
    method: 'POST',
  });
}

const paramsP = { params: Promise.resolve({ id: 'd1' }) };

describe('POST /api/manager/documents/[id]/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commentCount.mockResolvedValue(0);
    // Route is gated by the opt-in manager_cabinet flag (3-point contract, §5).
    process.env.FEATURE_MANAGER_CABINET = '1';
  });

  it('returns 404 when manager_cabinet feature flag is disabled', async () => {
    process.env.FEATURE_MANAGER_CABINET = '0';
    const res = await downloadGet(getReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(documentFindUnique).not.toHaveBeenCalled();
  });

  it('redirects when user is not a manager', async () => {
    getSession.mockResolvedValue({ sub: 'u', role: 'admin' });
    await expect(downloadGet(getReq() as never, paramsP)).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects when managedOrgIds is undefined (session loader did not run)', async () => {
    getSession.mockResolvedValue({ sub: 'u', role: 'manager' });
    await expect(downloadGet(getReq() as never, paramsP)).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('returns 404 for non-existent document', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: ['org-a'] }));
    documentFindUnique.mockResolvedValue(null);
    const res = await downloadGet(getReq() as never, paramsP);
    expect(res.status).toBe(404);
  });

  it('returns 404 silently for out-of-scope document (no managerId/org/comments match)', async () => {
    getSession.mockResolvedValue(managerSession({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'p',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      order: { managerId: 'someone-else', organizationId: 'org-b' },
    });
    commentCount.mockResolvedValue(0);
    const res = await downloadGet(getReq() as never, paramsP);
    expect(res.status).toBe(404);
  });

  it('returns 410 for in-scope infected document (per-org path)', async () => {
    getSession.mockResolvedValue(managerSession({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'p',
      mimeType: 'application/pdf',
      scanStatus: 'infected',
      scanReason: 'EICAR',
      order: { managerId: null, organizationId: 'org-a' },
    });
    const res = await downloadGet(getReq() as never, paramsP);
    expect(res.status).toBe(410);
  });

  it('returns 200 JSON with signed URL for clean in-scope document (per-org path)', async () => {
    getSession.mockResolvedValue(managerSession({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'contract.pdf',
      path: 'org-a/contract.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      order: { managerId: null, organizationId: 'org-a' },
    });
    createSignedUrl.mockResolvedValue('https://signed.test/x');

    const res = await downloadGet(getReq() as never, paramsP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      downloadUrl: 'https://signed.test/x',
      expiresInSec: expect.any(Number),
      fileName: 'contract.pdf',
    });
    expect(createSignedUrl).toHaveBeenCalledWith('org-a/contract.pdf', expect.any(Number), {
      download: expect.any(String),
    });
    expect(auditCreate).toHaveBeenCalled();
  });

  it('returns 200 for per-order path (managerId matches session.sub)', async () => {
    getSession.mockResolvedValue(managerSession({ sub: 'u-mgr-1', managedOrgIds: [] }));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'own.pdf',
      path: 'p/own.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      order: { managerId: 'u-mgr-1', organizationId: 'org-x' },
    });
    createSignedUrl.mockResolvedValue('https://signed.test/own');

    const res = await downloadGet(getReq() as never, paramsP);
    expect(res.status).toBe(200);
    expect(commentCount).not.toHaveBeenCalled(); // hot-path skip
  });

  it('returns 200 for comments-history path (per-order/org miss, comments hit)', async () => {
    getSession.mockResolvedValue(managerSession({ sub: 'u-mgr-1', managedOrgIds: [] }));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'historical.pdf',
      path: 'p/historical.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      order: { managerId: 'someone-else', organizationId: 'org-z' },
    });
    commentCount.mockResolvedValue(2);
    createSignedUrl.mockResolvedValue('https://signed.test/h');

    const res = await downloadGet(getReq() as never, paramsP);
    expect(res.status).toBe(200);
    expect(commentCount).toHaveBeenCalled();
  });

  it('returns 502 if signed URL creation throws (storage error)', async () => {
    getSession.mockResolvedValue(managerSession({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'org-a/x.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      order: { managerId: null, organizationId: 'org-a' },
    });
    createSignedUrl.mockRejectedValue(new Error('storage down'));

    const res = await downloadGet(getReq() as never, paramsP);
    expect(res.status).toBe(502);
  });

  it('returns 502 if signed URL creation throws a non-Error (String(error) branch)', async () => {
    getSession.mockResolvedValue(managerSession({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'org-a/x.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      order: { managerId: null, organizationId: 'org-a' },
    });
    createSignedUrl.mockRejectedValue('provider exploded');

    const res = await downloadGet(getReq() as never, paramsP);
    expect(res.status).toBe(502);
  });
});
