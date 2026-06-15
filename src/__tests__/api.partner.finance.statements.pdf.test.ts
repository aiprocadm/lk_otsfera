import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSession,
  notFoundIfDisabled,
  commissionStatementFindFirst,
  createSignedUrl
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  notFoundIfDisabled: vi.fn(),
  commissionStatementFindFirst: vi.fn(),
  createSignedUrl: vi.fn()
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    commissionStatement: { findFirst: commissionStatementFindFirst }
  }
}));
vi.mock('@/lib/storage/supabase', () => ({
  documentBucket: 'documents',
  getServerClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl
      })
    }
  })
}));

import { GET } from '@/app/api/partner/finance/statements/[id]/pdf/route';

const partnerSession = {
  sub: 'u-partner',
  role: 'partner' as const,
  partnerId: 'p1',
  partnerRole: 'admin',
  assignedOrgIds: []
};

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function getReq() {
  return new Request('http://x/api/partner/finance/statements/s1/pdf');
}

describe('GET /api/partner/finance/statements/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: feature enabled
    notFoundIfDisabled.mockReturnValue(null);
    getSession.mockResolvedValue(partnerSession);
  });

  it('returns 404 when commission_pdf feature is disabled', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await GET(getReq(), ctx('s1'));
    expect(res.status).toBe(404);
    expect(commissionStatementFindFirst).not.toHaveBeenCalled();
  });

  it('returns 401 when session is missing', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(getReq(), ctx('s1'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 when session is not a partner', async () => {
    getSession.mockResolvedValue({ sub: 'u-admin', role: 'admin' });
    const res = await GET(getReq(), ctx('s1'));
    expect(res.status).toBe(403);
  });

  it('returns 403 when partner has no partnerId', async () => {
    getSession.mockResolvedValue({ sub: 'u-p', role: 'partner' });
    const res = await GET(getReq(), ctx('s1'));
    expect(res.status).toBe(403);
  });

  it('returns 404 when statement is not found for this partner', async () => {
    commissionStatementFindFirst.mockResolvedValue(null);
    const res = await GET(getReq(), ctx('s1'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Not found');
  });

  it('returns 404 when statement exists but pdfPath is null', async () => {
    commissionStatementFindFirst.mockResolvedValue({ pdfPath: null });
    const res = await GET(getReq(), ctx('s1'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PDF not yet generated');
  });

  it('returns 502 when storage createSignedUrl returns an error', async () => {
    commissionStatementFindFirst.mockResolvedValue({ pdfPath: 'uploads/stmt.pdf' });
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'bucket not found' }
    });
    const res = await GET(getReq(), ctx('s1'));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Storage failure');
  });

  it('returns 502 when storage returns no signedUrl even without an error', async () => {
    commissionStatementFindFirst.mockResolvedValue({ pdfPath: 'uploads/stmt.pdf' });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: null }, error: null });
    const res = await GET(getReq(), ctx('s1'));
    expect(res.status).toBe(502);
  });

  it('returns 307 redirect to signed URL on success', async () => {
    commissionStatementFindFirst.mockResolvedValue({ pdfPath: 'uploads/stmt.pdf' });
    const signedUrl = 'https://storage.example.com/signed-stmt.pdf?token=abc';
    createSignedUrl.mockResolvedValue({ data: { signedUrl }, error: null });

    const res = await GET(getReq(), ctx('s1'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(signedUrl);
  });

  it('scopes the statement query to the authenticated partner', async () => {
    commissionStatementFindFirst.mockResolvedValue({ pdfPath: 'uploads/stmt.pdf' });
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/file.pdf' },
      error: null
    });

    await GET(getReq(), ctx('stmt-abc'));

    expect(commissionStatementFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'stmt-abc', partnerId: 'p1' }
      })
    );
  });
});
