import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireManager, findUniqueMock, createSignedUrlMock } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  findUniqueMock: vi.fn(),
  createSignedUrlMock: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { call: { findUnique: findUniqueMock } },
}));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ createSignedUrl: createSignedUrlMock }),
}));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));

import { GET as recordingGet } from '@/app/api/manager/calls/[id]/recording/route';
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

const paramsP = { params: Promise.resolve({ id: 'call-1' }) };

function buildReq() {
  return new Request('https://app.local/api/manager/calls/call-1/recording');
}

describe('GET /api/manager/calls/[id]/recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManager.mockResolvedValue(managerSession());
    vi.mocked(notFoundIfDisabled).mockReturnValue(undefined as never);
  });

  it('returns 404 when the telephony_mango flag is disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }) as never);
    const res = await recordingGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the call does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await recordingGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns 404 for another company's call (IDOR)", async () => {
    requireManager.mockResolvedValue(managerSession('co-a'));
    findUniqueMock.mockResolvedValue({
      companyId: 'co-b',
      recordingPath: 'calls/rec.mp3',
      recordingScanStatus: 'clean',
    });
    const res = await recordingGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 404 for an unresolved call (companyId null)', async () => {
    requireManager.mockResolvedValue(managerSession('co-a'));
    findUniqueMock.mockResolvedValue({
      companyId: null,
      recordingPath: 'calls/rec.mp3',
      recordingScanStatus: 'clean',
    });
    const res = await recordingGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 404 when session has no companyId', async () => {
    requireManager.mockResolvedValue(managerSession(null));
    findUniqueMock.mockResolvedValue({
      companyId: 'co-a',
      recordingPath: 'calls/rec.mp3',
      recordingScanStatus: 'clean',
    });
    const res = await recordingGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 404 when recordingScanStatus is pending', async () => {
    findUniqueMock.mockResolvedValue({
      companyId: 'co-a',
      recordingPath: 'calls/rec.mp3',
      recordingScanStatus: 'pending',
    });
    const res = await recordingGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 410 Gone when recordingScanStatus is infected (quarantined, per CLAUDE.md §10)', async () => {
    findUniqueMock.mockResolvedValue({
      companyId: 'co-a',
      recordingPath: 'calls/rec.mp3',
      recordingScanStatus: 'infected',
    });
    const res = await recordingGet(buildReq() as never, paramsP);
    expect(res.status).toBe(410);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 404 when recordingScanStatus is none', async () => {
    findUniqueMock.mockResolvedValue({
      companyId: 'co-a',
      recordingPath: 'calls/rec.mp3',
      recordingScanStatus: 'none',
    });
    const res = await recordingGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 404 when recordingScanStatus is error', async () => {
    findUniqueMock.mockResolvedValue({
      companyId: 'co-a',
      recordingPath: 'calls/rec.mp3',
      recordingScanStatus: 'error',
    });
    const res = await recordingGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 404 when recordingPath is null even if scanStatus is clean', async () => {
    findUniqueMock.mockResolvedValue({
      companyId: 'co-a',
      recordingPath: null,
      recordingScanStatus: 'clean',
    });
    const res = await recordingGet(buildReq() as never, paramsP);
    expect(res.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns 302 to the presigned URL when clean + same company + path present', async () => {
    requireManager.mockResolvedValue(managerSession('co-a'));
    findUniqueMock.mockResolvedValue({
      companyId: 'co-a',
      recordingPath: 'calls/rec-xyz.mp3',
      recordingScanStatus: 'clean',
    });
    createSignedUrlMock.mockResolvedValue('https://s3.example.com/signed?x=1');

    const res = await recordingGet(buildReq() as never, paramsP);

    expect(createSignedUrlMock).toHaveBeenCalledWith('calls/rec-xyz.mp3', 600, {
      download: 'recording.mp3',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://s3.example.com/signed?x=1');
  });
});
