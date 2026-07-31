import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireManager, findUniqueMock, createSignedUrlMock } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  findUniqueMock: vi.fn(),
  createSignedUrlMock: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { inboundMessage: { findUnique: findUniqueMock } },
}));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ createSignedUrl: createSignedUrlMock }),
}));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));

import { GET as attachmentGet } from '@/app/api/manager/inbox/[id]/attachment/route';
import { notFoundIfDisabled } from '@/lib/featureFlags';

function managerSession(companyId: string | null = 'co-a') {
  return {
    sub: 'u-mgr-1',
    role: 'manager',
    email: 'mgr@local',
    companyId,
    managedOrgIds: [],
  };
}

function boundMessage(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'co-a',
    status: 'bound',
    attachmentPath: 'inbound/att-1.pdf',
    attachmentName: 'договор.pdf',
    scanStatus: 'clean',
    ...overrides,
  };
}

const paramsP = { params: Promise.resolve({ id: 'msg-1' }) };

function buildReq() {
  return new Request('https://app.local/api/manager/inbox/msg-1/attachment');
}

describe('GET /api/manager/inbox/[id]/attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManager.mockResolvedValue(managerSession());
    vi.mocked(notFoundIfDisabled).mockReturnValue(undefined as never);
  });

  it('returns 404 when the inbound_messaging flag is disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(
      new Response('Not Found', { status: 404 }) as never
    );
    const res = await attachmentGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(vi.mocked(notFoundIfDisabled)).toHaveBeenCalledWith('inbound_messaging');
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('propagates requireManager rejection (auth guard before DB access)', async () => {
    requireManager.mockRejectedValue(new Error('redirect:/login'));
    await expect(attachmentGet(buildReq() as never, paramsP)).rejects.toThrow('redirect:/login');
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the message does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await attachmentGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns 404 for another company's bound message (IDOR, not 403)", async () => {
    requireManager.mockResolvedValue(managerSession('co-a'));
    findUniqueMock.mockResolvedValue(boundMessage({ companyId: 'co-b' }));
    const res = await attachmentGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 404 for a bound message when session has no companyId', async () => {
    requireManager.mockResolvedValue(managerSession(null));
    findUniqueMock.mockResolvedValue(boundMessage());
    const res = await attachmentGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 404 when attachmentPath is null even if scanStatus is clean', async () => {
    findUniqueMock.mockResolvedValue(boundMessage({ attachmentPath: null }));
    const res = await attachmentGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 410 Gone when scanStatus is infected (quarantined, per CLAUDE.md §10)', async () => {
    findUniqueMock.mockResolvedValue(boundMessage({ scanStatus: 'infected' }));
    const res = await attachmentGet(buildReq() as never, paramsP);
    expect(res.status).toBe(410);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it.each(['pending', 'none', 'error'])('returns 404 when scanStatus is %s', async (scanStatus) => {
    findUniqueMock.mockResolvedValue(boundMessage({ scanStatus }));
    const res = await attachmentGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 302 to the presigned URL for own-company bound message (clean)', async () => {
    requireManager.mockResolvedValue(managerSession('co-a'));
    findUniqueMock.mockResolvedValue(boundMessage());
    createSignedUrlMock.mockResolvedValue('https://s3.example.com/signed?x=1');

    const res = await attachmentGet(buildReq() as never, paramsP);

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      select: {
        companyId: true,
        status: true,
        attachmentPath: true,
        attachmentName: true,
        scanStatus: true,
      },
    });
    expect(createSignedUrlMock).toHaveBeenCalledWith('inbound/att-1.pdf', 600, {
      download: 'договор.pdf',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://s3.example.com/signed?x=1');
  });

  it('returns 302 for an unresolved message (companyId null — shared triage queue)', async () => {
    requireManager.mockResolvedValue(managerSession('co-a'));
    findUniqueMock.mockResolvedValue(boundMessage({ companyId: null, status: 'unresolved' }));
    createSignedUrlMock.mockResolvedValue('https://s3.example.com/signed?y=2');

    const res = await attachmentGet(buildReq() as never, paramsP);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://s3.example.com/signed?y=2');
  });

  it("falls back to download name 'attachment' when attachmentName is null", async () => {
    findUniqueMock.mockResolvedValue(boundMessage({ attachmentName: null }));
    createSignedUrlMock.mockResolvedValue('https://s3.example.com/signed?z=3');

    const res = await attachmentGet(buildReq() as never, paramsP);

    expect(createSignedUrlMock).toHaveBeenCalledWith('inbound/att-1.pdf', 600, {
      download: 'attachment',
    });
    expect(res.status).toBe(302);
  });
});
