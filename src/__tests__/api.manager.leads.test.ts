import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/requireRole', () => ({ requireManager: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/manager/leads', () => ({ listManagerLeads: vi.fn(), getManagerLead: vi.fn() }));
vi.mock('@/lib/services/manager/leadLifecycle', () => ({
  assignLead: vi.fn(), setLeadStatus: vi.fn(), promoteLead: vi.fn(), rejectLead: vi.fn()
}));

import { requireManager } from '@/lib/auth/requireRole';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { listManagerLeads, getManagerLead } from '@/lib/services/manager/leads';
import { assignLead, promoteLead, setLeadStatus, rejectLead } from '@/lib/services/manager/leadLifecycle';
import { GET } from '@/app/api/manager/leads/route';
import { GET as GET_SINGLE, PATCH } from '@/app/api/manager/leads/[id]/route';

const session = { sub: 'm1', role: 'manager', companyId: 'c1' } as never;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patchReq = (body: unknown) =>
  new Request('http://x/', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireManager).mockResolvedValue(session);
  vi.mocked(notFoundIfDisabled).mockReturnValue(undefined as never);
});

describe('GET /api/manager/leads', () => {
  it('returns the team-queue list', async () => {
    vi.mocked(listManagerLeads).mockResolvedValue({ rows: [], nextCursor: null });
    const res = await GET(new Request('http://x/manager/leads?status=new'));
    expect(res.status).toBe(200);
    expect(vi.mocked(listManagerLeads)).toHaveBeenCalledWith({}, expect.objectContaining({ status: 'new' }));
  });

  it('passes assignedToMe=1 as the manager id', async () => {
    vi.mocked(listManagerLeads).mockResolvedValue({ rows: [], nextCursor: null });
    await GET(new Request('http://x/manager/leads?assignedToMe=1'));
    expect(vi.mocked(listManagerLeads)).toHaveBeenCalledWith({}, expect.objectContaining({ assignedToUserId: 'm1' }));
  });

  it('404 when the manager cabinet flag is disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }) as never);
    const res = await GET(new Request('http://x/manager/leads'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/manager/leads/[id]', () => {
  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }) as never);
    const res = await GET_SINGLE(new Request('http://x/'), ctx('L1'));
    expect(res.status).toBe(404);
  });

  it('404 when lead not found', async () => {
    vi.mocked(getManagerLead).mockResolvedValue(null);
    const res = await GET_SINGLE(new Request('http://x/'), ctx('L1'));
    expect(res.status).toBe(404);
  });

  it('200 when lead exists', async () => {
    vi.mocked(getManagerLead).mockResolvedValue({ id: 'L1', status: 'new' } as never);
    const res = await GET_SINGLE(new Request('http://x/'), ctx('L1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead).toMatchObject({ id: 'L1' });
  });
});

describe('PATCH /api/manager/leads/[id]', () => {
  it('assign → 200', async () => {
    vi.mocked(assignLead).mockResolvedValue({ id: 'L1' } as never);
    const res = await PATCH(patchReq({ action: 'assign' }), ctx('L1'));
    expect(res.status).toBe(200);
    expect(vi.mocked(assignLead)).toHaveBeenCalledWith({}, expect.objectContaining({ leadId: 'L1', managerId: 'm1' }));
  });

  it('promote → 201 with orderId', async () => {
    vi.mocked(promoteLead).mockResolvedValue({ order: { id: 'ord9' }, lead: { id: 'L1' } } as never);
    const res = await PATCH(patchReq({ action: 'promote' }), ctx('L1'));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ orderId: 'ord9' });
  });

  it('maps LIFECYCLE_VIOLATION → 409', async () => {
    vi.mocked(promoteLead).mockRejectedValue(new Error('LIFECYCLE_VIOLATION: lead already promoted'));
    const res = await PATCH(patchReq({ action: 'promote' }), ctx('L1'));
    expect(res.status).toBe(409);
  });

  it('maps NOT_FOUND → 404', async () => {
    vi.mocked(setLeadStatus).mockRejectedValue(new Error('NOT_FOUND: lead'));
    const res = await PATCH(patchReq({ action: 'setStatus', status: 'qualified' }), ctx('Lx'));
    expect(res.status).toBe(404);
  });

  it('unknown action → 400', async () => {
    const res = await PATCH(patchReq({ action: 'frobnicate' }), ctx('L1'));
    expect(res.status).toBe(400);
  });

  it('404 when feature flag disabled for PATCH', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }) as never);
    const res = await PATCH(patchReq({ action: 'assign' }), ctx('L1'));
    expect(res.status).toBe(404);
  });

  it('reject → 200 with explicit reason', async () => {
    vi.mocked(rejectLead).mockResolvedValue({ id: 'L1' } as never);
    const res = await PATCH(patchReq({ action: 'reject', reason: 'не прошёл' }), ctx('L1'));
    expect(res.status).toBe(200);
    expect(vi.mocked(rejectLead)).toHaveBeenCalledWith({}, expect.objectContaining({ leadId: 'L1', reason: 'не прошёл' }));
  });

  it('reject → 200 without reason (defaults to empty string)', async () => {
    vi.mocked(rejectLead).mockResolvedValue({ id: 'L1' } as never);
    const res = await PATCH(patchReq({ action: 'reject' }), ctx('L1'));
    expect(res.status).toBe(200);
    expect(vi.mocked(rejectLead)).toHaveBeenCalledWith({}, expect.objectContaining({ reason: '' }));
  });

  it('setStatus → 200', async () => {
    vi.mocked(setLeadStatus).mockResolvedValue({ id: 'L1' } as never);
    const res = await PATCH(patchReq({ action: 'setStatus', status: 'qualified' }), ctx('L1'));
    expect(res.status).toBe(200);
  });

  it('throws unknown errors (non-LIFECYCLE_VIOLATION, non-NOT_FOUND)', async () => {
    vi.mocked(assignLead).mockRejectedValue(new Error('UNEXPECTED_ERROR: something broke'));
    await expect(PATCH(patchReq({ action: 'assign' }), ctx('L1'))).rejects.toThrow('UNEXPECTED_ERROR');
  });

  it('throws non-Error from service (mapError branch[0]: not instanceof Error → msg=Unknown error)', async () => {
    vi.mocked(assignLead).mockRejectedValue('plain string rejection');
    await expect(PATCH(patchReq({ action: 'assign' }), ctx('L1'))).rejects.toBe('plain string rejection');
  });
});
