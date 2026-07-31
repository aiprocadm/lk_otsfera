import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, cookiesGet, documentFindUnique, auditCreate, createSignedUrl, redirectMock } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    cookiesGet: vi.fn().mockReturnValue(undefined),
    documentFindUnique: vi.fn(),
    auditCreate: vi.fn(),
    createSignedUrl: vi.fn(),
    redirectMock: vi.fn(() => {
      throw new Error('REDIRECT');
    }),
  }));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookiesGet }),
}));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    document: { findUnique: documentFindUnique },
    auditLog: { create: auditCreate },
  },
}));
const { markDocumentViewed } = vi.hoisted(() => ({
  markDocumentViewed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/services/documents/viewMarks', () => ({ markDocumentViewed }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    createSignedUrl,
    upload: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
  }),
}));

import { POST as downloadPost } from '@/app/api/organization/documents/[id]/download/route';

function orgSession(orgIds: { id: string; isActive?: boolean }[]) {
  return {
    sub: 'u-org-1',
    role: 'organization',
    email: 'user@org.local',
    organizationMemberships: orgIds.map((o) => ({
      organizationId: o.id,
      roleInOrg: 'member',
      isActive: o.isActive !== false,
    })),
  };
}

function postReq(query = ''): Request {
  return new Request(`https://app.local/api/organization/documents/d1/download${query}`, {
    method: 'POST',
  });
}

const paramsP = { params: Promise.resolve({ id: 'd1' }) };

describe('POST /api/organization/documents/[id]/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesGet.mockReturnValue(undefined);
    // Route is gated by the opt-in organization_cabinet flag (3-point contract, §5).
    process.env.FEATURE_ORGANIZATION_CABINET = '1';
  });

  it('returns 404 when organization_cabinet feature flag is disabled', async () => {
    process.env.FEATURE_ORGANIZATION_CABINET = '0';
    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(404);
    expect(documentFindUnique).not.toHaveBeenCalled();
    delete process.env.FEATURE_ORGANIZATION_CABINET;
  });

  it('respects ?ttl= query param within MIN/MAX bounds', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'contract.pdf',
      path: 'org-a/contract.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-a',
    });
    createSignedUrl.mockResolvedValue('https://signed.test/x');

    // Request TTL=200 (within 60-300 range)
    const res = await downloadPost(postReq('?ttl=200'), paramsP);
    expect(res.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledWith('org-a/contract.pdf', 200);
    // Этап 3 PR-2 (ФТ-6.6): скачивание гасит бейдж «новый».
    expect(markDocumentViewed).toHaveBeenCalledWith(expect.anything(), {
      documentId: 'd1',
      userId: orgSession([]).sub,
    });
  });

  it('clamps ?ttl= above MAX_TTL (300) to 300', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'org-a/x.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-a',
    });
    createSignedUrl.mockResolvedValue('https://signed.test/x');

    const res = await downloadPost(postReq('?ttl=9999'), paramsP);
    expect(res.status).toBe(200);
    // Should be clamped to MAX_TTL=300
    expect(createSignedUrl).toHaveBeenCalledWith('org-a/x.pdf', 300);
  });

  it('clamps ?ttl= below MIN_TTL (60) to 60', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'org-a/x.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-a',
    });
    createSignedUrl.mockResolvedValue('https://signed.test/x');

    const res = await downloadPost(postReq('?ttl=5'), paramsP);
    expect(res.status).toBe(200);
    // Should be clamped to MIN_TTL=60
    expect(createSignedUrl).toHaveBeenCalledWith('org-a/x.pdf', 60);
  });

  it('uses DEFAULT_TTL when ?ttl= is non-numeric', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'org-a/x.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-a',
    });
    createSignedUrl.mockResolvedValue('https://signed.test/x');

    const res = await downloadPost(postReq('?ttl=abc'), paramsP);
    expect(res.status).toBe(200);
    // DEFAULT_TTL=120 is within bounds, so it passes through
    expect(createSignedUrl).toHaveBeenCalledWith('org-a/x.pdf', 120);
  });

  it('uses org context from org_ctx cookie when ?org= is not in query', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }, { id: 'org-b' }]));
    cookiesGet.mockReturnValue({ value: 'org-b' });
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'b-doc.pdf',
      path: 'org-b/b-doc.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-b',
    });
    createSignedUrl.mockResolvedValue('https://signed.test/cookie');

    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(200);
  });

  it('redirects when user is not organization-role', async () => {
    getSession.mockResolvedValue({ sub: 'u', role: 'admin' });
    await expect(downloadPost(postReq(), paramsP)).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects org-role without active memberships', async () => {
    getSession.mockResolvedValue({ sub: 'u', role: 'organization', organizationMemberships: [] });
    await expect(downloadPost(postReq(), paramsP)).rejects.toThrow('REDIRECT');
  });

  it('returns 404 for non-existent document', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue(null);
    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(404);
  });

  it('returns 404 silently for foreign-org document', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'p',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-b',
    });
    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(404);
  });

  it('returns 410 for infected document (with scanReason)', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'p',
      mimeType: 'application/pdf',
      scanStatus: 'infected',
      scanReason: 'EICAR',
      counterpartyType: 'organization',
      counterpartyId: 'org-a',
    });
    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code?: string; scanReason?: string };
    expect(body.code).toBe('INFECTED');
    expect(body.scanReason).toBe('EICAR');
  });

  it('returns 410 for infected document with null scanReason (?? undefined fallback)', async () => {
    // When scanReason is null, result.scanReason ?? undefined = undefined → omitted from body
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'p',
      mimeType: 'application/pdf',
      scanStatus: 'infected',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-a',
    });
    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code?: string; scanReason?: unknown };
    expect(body.code).toBe('INFECTED');
    expect(body.scanReason).toBeUndefined();
  });

  it('returns 200 with signed URL for clean own document', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'contract.pdf',
      path: 'org-a/contract.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-a',
    });
    createSignedUrl.mockResolvedValue('https://signed.test/x');

    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { downloadUrl: string; fileName: string };
    expect(body.downloadUrl).toBe('https://signed.test/x');
    expect(body.fileName).toBe('contract.pdf');
    expect(createSignedUrl).toHaveBeenCalledWith('org-a/contract.pdf', expect.any(Number));
    expect(auditCreate).toHaveBeenCalled();
  });

  it('honors ?org=<id> query to pick org context for multi-org users', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }, { id: 'org-b' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'b-doc.pdf',
      path: 'org-b/b-doc.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-b',
    });
    createSignedUrl.mockResolvedValue('https://signed.test/b');

    const res = await downloadPost(postReq('?org=org-b'), paramsP);
    expect(res.status).toBe(200);
  });

  it('rejects with 404 when ?org=<id> does not match user memberships', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'p',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-c',
    });
    // queryOrg 'org-c' is not in memberships → resolveActiveOrgId falls back to first
    // active membership 'org-a', then doc.counterpartyId 'org-c' !== 'org-a' → silent 404.
    const res = await downloadPost(postReq('?org=org-c'), paramsP);
    expect(res.status).toBe(404);
  });

  it('returns 502 if signed URL creation throws (storage error)', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'org-a/x.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-a',
    });
    createSignedUrl.mockRejectedValue(new Error('storage down'));

    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(502);
  });

  it('returns 502 if signed URL creation throws a non-Error (String(error) branch)', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'org-a/x.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-a',
    });
    createSignedUrl.mockRejectedValue('provider exploded');

    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(502);
  });
});
