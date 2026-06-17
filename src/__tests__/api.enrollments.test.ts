import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/enrollments/submit', () => ({ submitEnrollmentRequest: vi.fn() }));
vi.mock('@/lib/services/enrollments/list', () => ({ listEnrollmentRequests: vi.fn() }));
vi.mock('@/lib/services/enrollments/list', () => ({ listEnrollmentRequests: vi.fn() }));
vi.mock('@/lib/services/enrollments/lifecycle', () => ({ approveEnrollment: vi.fn(), rejectEnrollment: vi.fn(), markProvisioned: vi.fn() }));

import { getSession } from '@/lib/auth/session';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { approveEnrollment, rejectEnrollment, markProvisioned } from '@/lib/services/enrollments/lifecycle';
import { POST, GET } from '@/app/api/enrollments/route';
import { PATCH } from '@/app/api/enrollments/[id]/route';

const partner = { sub: 'p', role: 'partner', partnerId: 'p1' } as never;
const manager = { sub: 'm', role: 'manager' } as never;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (b: unknown, method = 'POST') =>
  new Request('http://x/', { method, body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(notFoundIfDisabled).mockReturnValue(null);
});

describe('POST /api/enrollments', () => {
  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(jsonReq({}))).status).toBe(401);
  });
  it('403 when canSubmitEnrollments returns false (student role)', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'student' } as never);
    expect((await POST(jsonReq({}))).status).toBe(403);
  });
  it('400 when body is null (non-JSON request)', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    const req = new Request('http://x/', { method: 'POST', body: 'not-json', headers: { 'content-type': 'text/plain' } });
    expect((await POST(req)).status).toBe(400);
  });
  it('201 when a partner submits', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    vi.mocked(submitEnrollmentRequest).mockResolvedValue({ id: 'E1' } as never);
    const res = await POST(jsonReq({ studentName: 'И', studentEmail: 'i@x.ru', courseTitle: 'ОТ' }));
    expect(res.status).toBe(201);
  });
  it('maps VALIDATION → 400', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    vi.mocked(submitEnrollmentRequest).mockRejectedValue(new Error('VALIDATION: required'));
    expect((await POST(jsonReq({}))).status).toBe(400);
  });
  it('maps FORBIDDEN → 403 from service', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    vi.mocked(submitEnrollmentRequest).mockRejectedValue(new Error('FORBIDDEN: not allowed'));
    expect((await POST(jsonReq({}))).status).toBe(403);
  });
  it('maps NOT_FOUND → 404 from service', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    vi.mocked(submitEnrollmentRequest).mockRejectedValue(new Error('NOT_FOUND: org'));
    expect((await POST(jsonReq({}))).status).toBe(404);
  });
  it('re-throws unknown errors from service (not wrapped)', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    vi.mocked(submitEnrollmentRequest).mockRejectedValue(new Error('UNEXPECTED_DB_ERROR'));
    await expect(POST(jsonReq({}))).rejects.toThrow('UNEXPECTED_DB_ERROR');
  });

  it('re-throws non-Error (string) from service (mapError branch[0]: not instanceof Error)', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    vi.mocked(submitEnrollmentRequest).mockRejectedValue('plain string rejection');
    await expect(POST(jsonReq({}))).rejects.toBe('plain string rejection');
  });
  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await POST(jsonReq({}))).status).toBe(404);
  });
});

describe('GET /api/enrollments', () => {
  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET(new Request('http://x/api/enrollments'))).status).toBe(401);
  });

  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await GET(new Request('http://x/api/enrollments'))).status).toBe(404);
  });

  it('200 returns result on success', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(listEnrollmentRequests).mockResolvedValue({ rows: [], nextCursor: null } as never);
    const res = await GET(new Request('http://x/api/enrollments?status=pending'));
    expect(res.status).toBe(200);
    expect(vi.mocked(listEnrollmentRequests)).toHaveBeenCalled();
  });

  it('ignores unknown status filter', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(listEnrollmentRequests).mockResolvedValue({ rows: [], nextCursor: null } as never);
    const res = await GET(new Request('http://x/api/enrollments?status=bogus'));
    expect(res.status).toBe(200);
    // status=undefined is passed to the service when filter is unknown
    expect(vi.mocked(listEnrollmentRequests)).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({ status: undefined })
    );
  });
});

describe('PATCH /api/enrollments/[id]', () => {
  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('E1'));
    expect(res.status).toBe(404);
  });

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('E1'));
    expect(res.status).toBe(401);
  });

  it('403 when a non-reviewer (partner) tries to approve', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('E1'));
    expect(res.status).toBe(403);
  });

  it('200 when a manager approves', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(approveEnrollment).mockResolvedValue({ id: 'E1', status: 'approved' } as never);
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('E1'));
    expect(res.status).toBe(200);
  });

  it('200 when a manager rejects with reason', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(rejectEnrollment).mockResolvedValue({ id: 'E1', status: 'rejected' } as never);
    const res = await PATCH(jsonReq({ action: 'reject', reason: 'no' }, 'PATCH'), ctx('E1'));
    expect(res.status).toBe(200);
  });

  it('200 when a manager rejects without reason (body?.reason ?? empty-string branch)', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(rejectEnrollment).mockResolvedValue({ id: 'E1', status: 'rejected' } as never);
    const res = await PATCH(jsonReq({ action: 'reject' }, 'PATCH'), ctx('E1'));
    expect(res.status).toBe(200);
    expect(vi.mocked(rejectEnrollment)).toHaveBeenCalledWith({}, expect.objectContaining({ reason: '' }));
  });

  it('maps VALIDATION → 400 from lifecycle', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(approveEnrollment).mockRejectedValue(new Error('VALIDATION: missing field'));
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('E1'));
    expect(res.status).toBe(400);
  });

  it('maps NOT_FOUND → 404 from lifecycle', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(approveEnrollment).mockRejectedValue(new Error('NOT_FOUND: enrollment'));
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('E1'));
    expect(res.status).toBe(404);
  });

  it('maps LIFECYCLE_VIOLATION → 409', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(markProvisioned).mockRejectedValue(new Error('LIFECYCLE_VIOLATION: cannot provision from pending'));
    const res = await PATCH(jsonReq({ action: 'markProvisioned', externalStudentId: 'X' }, 'PATCH'), ctx('E1'));
    expect(res.status).toBe(409);
  });

  it('unknown action → 400', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    const res = await PATCH(jsonReq({ action: 'nope' }, 'PATCH'), ctx('E1'));
    expect(res.status).toBe(400);
  });

  it('markProvisioned uses empty string when externalStudentId is missing from body', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(markProvisioned).mockResolvedValue({ id: 'E1', status: 'provisioned' } as never);
    // body has no externalStudentId — should default to ''
    const res = await PATCH(jsonReq({ action: 'markProvisioned' }, 'PATCH'), ctx('E1'));
    expect(res.status).toBe(200);
    expect(vi.mocked(markProvisioned)).toHaveBeenCalledWith({}, expect.objectContaining({ externalStudentId: '' }));
  });

  it('re-throws unknown errors (not wrapped)', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(approveEnrollment).mockRejectedValue(new Error('UNEXPECTED_DB_ERROR'));
    await expect(PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('E1'))).rejects.toThrow('UNEXPECTED_DB_ERROR');
  });

  it('re-throws non-Error (string) from service (mapError branch[0]: not instanceof Error)', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(approveEnrollment).mockRejectedValue('plain string rejection');
    await expect(PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('E1'))).rejects.toBe('plain string rejection');
  });
});
