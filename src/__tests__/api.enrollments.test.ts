import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/enrollments/submit', () => ({ submitEnrollmentRequest: vi.fn() }));
vi.mock('@/lib/services/enrollments/list', () => ({ listEnrollmentRequests: vi.fn() }));
vi.mock('@/lib/services/enrollments/lifecycle', () => ({ approveEnrollment: vi.fn(), rejectEnrollment: vi.fn(), markProvisioned: vi.fn() }));

import { getSession } from '@/lib/auth/session';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import { approveEnrollment, markProvisioned } from '@/lib/services/enrollments/lifecycle';
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
});

describe('PATCH /api/enrollments/[id]', () => {
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
});
