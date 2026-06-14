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
import { listManagerLeads } from '@/lib/services/manager/leads';
import { assignLead, promoteLead, setLeadStatus } from '@/lib/services/manager/leadLifecycle';
import { GET } from '@/app/api/manager/leads/route';
import { PATCH } from '@/app/api/manager/leads/[id]/route';

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
});
