import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/finance', () => ({
  getFinanceKpis: vi.fn(),
  listStatements: vi.fn(),
  getStatementWithItems: vi.fn()
}));
vi.mock('@/lib/services/commission/statement', () => ({
  calculateStatementForPartner: vi.fn()
}));
vi.mock('@/lib/services/commission/lifecycle', () => ({
  approveStatement: vi.fn(),
  markStatementPaid: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    commissionStatement: { findFirst: vi.fn() }
  }
}));

import { getSession } from '@/lib/auth/session';
import { getFinanceKpis, listStatements, getStatementWithItems } from '@/lib/services/partner/finance';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';
import { approveStatement, markStatementPaid } from '@/lib/services/commission/lifecycle';
import { GET } from '@/app/api/partner/finance/route';
import { POST } from '@/app/api/partner/finance/statements/route';
import { GET as GET_STMT, PATCH } from '@/app/api/partner/finance/statements/[id]/route';

const partnerManagerSession = { sub: 'u1', role: 'partner', partnerId: 'p1', partnerRole: 'manager', assignedOrgIds: [] } as any;
const partnerAdminSession = { sub: 'u2', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: [] } as any;
const platformAdminSession = { sub: 'u3', role: 'admin' } as any;
const orgSession = { sub: 'u4', role: 'organization' } as any;

function ctx(id: string) { return { params: Promise.resolve({ id }) }; }
function getReq(url = 'http://x/') { return new Request(url); }
function jsonReq(b: unknown, method = 'POST') {
  return new Request('http://x/', {
    method,
    body: JSON.stringify(b),
    headers: { 'content-type': 'application/json' }
  });
}

const stubStatement = { id: 's1', status: 'draft', partnerId: 'p1', totalCommissionAmount: 5000 };
const stubKpis = { earnedTotal: 0, pendingTotal: 5000, paidTotal: 0 };

describe('GET /api/partner/finance', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET(getReq())).status).toBe(401);
  });

  it('403 non-partner', async () => {
    vi.mocked(getSession).mockResolvedValue(orgSession);
    expect((await GET(getReq())).status).toBe(403);
  });

  it('200 returns kpis and statements', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerManagerSession);
    vi.mocked(getFinanceKpis).mockResolvedValue(stubKpis);
    vi.mocked(listStatements).mockResolvedValue([]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kpis).toEqual(stubKpis);
  });

  it('passes from/to date params to listStatements when provided', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerManagerSession);
    vi.mocked(getFinanceKpis).mockResolvedValue(stubKpis);
    vi.mocked(listStatements).mockResolvedValue([]);
    await GET(getReq('http://x/?from=2026-01-01&to=2026-03-31&status=approved&skip=5&take=10'));
    expect(listStatements).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      from: expect.any(Date),
      to: expect.any(Date),
      status: 'approved',
      skip: 5,
      take: 10
    }));
  });
});

describe('POST /api/partner/finance/statements', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(jsonReq({ periodFrom: '2026-04-01', periodTo: '2026-04-30' }))).status).toBe(401);
  });

  it('403 partner-manager (not admin)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerManagerSession);
    expect((await POST(jsonReq({ periodFrom: '2026-04-01', periodTo: '2026-04-30' }))).status).toBe(403);
  });

  it('400 missing dates', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    expect((await POST(jsonReq({}))).status).toBe(400);
  });

  it('201 created new statement', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    vi.mocked(calculateStatementForPartner).mockResolvedValue({ statement: stubStatement as any, itemCount: 3, isNew: true });
    const res = await POST(jsonReq({ periodFrom: '2026-04-01', periodTo: '2026-04-30' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.isNew).toBe(true);
  });

  it('200 updated existing draft statement', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    vi.mocked(calculateStatementForPartner).mockResolvedValue({ statement: stubStatement as any, itemCount: 3, isNew: false });
    const res = await POST(jsonReq({ periodFrom: '2026-04-01', periodTo: '2026-04-30' }));
    expect(res.status).toBe(200);
  });

  // C-05: manual path must reject a period overlapping an existing statement.
  it('409 when the period overlaps an existing statement (PERIOD_OVERLAP)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    vi.mocked(calculateStatementForPartner).mockRejectedValue(new Error('PERIOD_OVERLAP: overlaps statement s9'));
    const res = await POST(jsonReq({ periodFrom: '2026-04-01', periodTo: '2026-06-30' }));
    expect(res.status).toBe(409);
  });

  it('asks the service to reject overlaps on the manual path (rejectOverlap=true)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    vi.mocked(calculateStatementForPartner).mockResolvedValue({ statement: stubStatement as any, itemCount: 1, isNew: true });
    await POST(jsonReq({ periodFrom: '2026-04-01', periodTo: '2026-04-30' }));
    expect(calculateStatementForPartner).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rejectOverlap: true })
    );
  });

  it('400 when dates are not parseable (Invalid Date)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    const res = await POST(jsonReq({ periodFrom: 'not-a-date', periodTo: '2026-04-30' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/date/i);
  });

  it('400 when periodFrom >= periodTo', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    const res = await POST(jsonReq({ periodFrom: '2026-04-30', periodTo: '2026-04-01' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/before/i);
  });

  it('re-throws unknown errors (not PERIOD_OVERLAP)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    vi.mocked(calculateStatementForPartner).mockRejectedValue(new Error('DB_CONSTRAINT_VIOLATION'));
    await expect(POST(jsonReq({ periodFrom: '2026-04-01', periodTo: '2026-04-30' }))).rejects.toThrow('DB_CONSTRAINT_VIOLATION');
  });

  it('re-throws non-Error (string) from service (branch[0]: not instanceof Error)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    vi.mocked(calculateStatementForPartner).mockRejectedValue('plain string rejection');
    await expect(POST(jsonReq({ periodFrom: '2026-04-01', periodTo: '2026-04-30' }))).rejects.toBe('plain string rejection');
  });
});

describe('GET /api/partner/finance/statements/[id]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET_STMT(getReq(), ctx('s1'))).status).toBe(401);
  });

  it('403 for non-partner', async () => {
    vi.mocked(getSession).mockResolvedValue(orgSession);
    expect((await GET_STMT(getReq(), ctx('s1'))).status).toBe(403);
  });

  it('404 statement not found', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerManagerSession);
    vi.mocked(getStatementWithItems).mockResolvedValue(null);
    expect((await GET_STMT(getReq(), ctx('s1'))).status).toBe(404);
  });

  it('200 returns statement', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerManagerSession);
    vi.mocked(getStatementWithItems).mockResolvedValue({ ...stubStatement, items: [] } as any);
    const res = await GET_STMT(getReq(), ctx('s1'));
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/partner/finance/statements/[id] — approve', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(401);
  });

  it('403 partner-manager cannot approve', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerManagerSession);
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(403);
  });

  it('200 partner-admin approves', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    vi.mocked(approveStatement).mockResolvedValue({ ok: true, statement: { ...stubStatement, status: 'approved' } } as any);
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ statement: { ...stubStatement, status: 'approved' } });
  });

  it('404 when statement not found (approve)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    vi.mocked(approveStatement).mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('409 duplicate approve (lifecycle_violation)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    vi.mocked(approveStatement).mockResolvedValue({ ok: false, error: 'lifecycle_violation' });
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'lifecycle_violation' });
  });
});

describe('PATCH /api/partner/finance/statements/[id] — markPaid', () => {
  beforeEach(() => vi.resetAllMocks());

  it('403 partner-admin cannot markPaid', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    const res = await PATCH(jsonReq({ action: 'markPaid' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(403);
  });

  it('200 platform-admin marks paid', async () => {
    vi.mocked(getSession).mockResolvedValue(platformAdminSession);
    vi.mocked(markStatementPaid).mockResolvedValue({ ok: true, statement: { ...stubStatement, status: 'paid' } } as any);
    const res = await PATCH(jsonReq({ action: 'markPaid' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ statement: { ...stubStatement, status: 'paid' } });
  });

  it('404 when statement not found (markPaid)', async () => {
    vi.mocked(getSession).mockResolvedValue(platformAdminSession);
    vi.mocked(markStatementPaid).mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await PATCH(jsonReq({ action: 'markPaid' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('403 when markPaid is forbidden by service', async () => {
    vi.mocked(getSession).mockResolvedValue(platformAdminSession);
    vi.mocked(markStatementPaid).mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await PATCH(jsonReq({ action: 'markPaid' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('409 lifecycle violation on markPaid', async () => {
    vi.mocked(getSession).mockResolvedValue(platformAdminSession);
    vi.mocked(markStatementPaid).mockResolvedValue({ ok: false, error: 'lifecycle_violation' });
    const res = await PATCH(jsonReq({ action: 'markPaid' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'lifecycle_violation' });
  });

  it('400 unknown action', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    const res = await PATCH(jsonReq({ action: 'badAction' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(400);
  });
});
