import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSession,
  cookiesGet,
  documentFindUnique,
  auditCreate,
  createSignedUrl,
  redirectMock
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  cookiesGet: vi.fn().mockReturnValue(undefined),
  documentFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  createSignedUrl: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error('REDIRECT');
  })
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookiesGet })
}));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    document: { findUnique: documentFindUnique },
    auditLog: { create: auditCreate }
  }
}));
vi.mock('@/lib/storage/supabase', () => ({
  documentBucket: 'docs',
  supabaseAdmin: {
    storage: { from: () => ({ createSignedUrl }) }
  }
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
      isActive: o.isActive !== false
    }))
  };
}

function postReq(query = ''): Request {
  return new Request(`https://app.local/api/organization/documents/d1/download${query}`, {
    method: 'POST'
  });
}

const paramsP = { params: Promise.resolve({ id: 'd1' }) };

describe('POST /api/organization/documents/[id]/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesGet.mockReturnValue(undefined);
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
      counterpartyId: 'org-b'
    });
    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(404);
  });

  it('returns 410 for infected document', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'p',
      mimeType: 'application/pdf',
      scanStatus: 'infected',
      scanReason: 'EICAR',
      counterpartyType: 'organization',
      counterpartyId: 'org-a'
    });
    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code?: string; scanReason?: string };
    expect(body.code).toBe('INFECTED');
    expect(body.scanReason).toBe('EICAR');
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
      counterpartyId: 'org-a'
    });
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.test/x' },
      error: null
    });

    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { downloadUrl: string; fileName: string };
    expect(body.downloadUrl).toBe('https://signed.test/x');
    expect(body.fileName).toBe('contract.pdf');
    expect(createSignedUrl).toHaveBeenCalledWith('org-a/contract.pdf', expect.any(Number));
    expect(auditCreate).toHaveBeenCalled();
  });

  it('honors ?org=<id> query to pick org context for multi-org users', async () => {
    getSession.mockResolvedValue(
      orgSession([{ id: 'org-a' }, { id: 'org-b' }])
    );
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'b-doc.pdf',
      path: 'org-b/b-doc.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-b'
    });
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.test/b' },
      error: null
    });

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
      counterpartyId: 'org-c'
    });
    // queryOrg 'org-c' is not in memberships → resolveActiveOrgId falls back to first
    // active membership 'org-a', then doc.counterpartyId 'org-c' !== 'org-a' → silent 404.
    const res = await downloadPost(postReq('?org=org-c'), paramsP);
    expect(res.status).toBe(404);
  });

  it('returns 502 if Supabase signed URL creation fails', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    documentFindUnique.mockResolvedValue({
      id: 'd1',
      name: 'x.pdf',
      path: 'org-a/x.pdf',
      mimeType: 'application/pdf',
      scanStatus: 'clean',
      scanReason: null,
      counterpartyType: 'organization',
      counterpartyId: 'org-a'
    });
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'storage down' } });

    const res = await downloadPost(postReq(), paramsP);
    expect(res.status).toBe(502);
  });
});
