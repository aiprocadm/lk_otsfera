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
import { prisma } from '@/lib/db/prisma';
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
});

describe('GET /api/partner/finance/statements/[id]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET_STMT(getReq(), ctx('s1'))).status).toBe(401);
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

  it('403 partner-manager cannot approve', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerManagerSession);
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(403);
  });

  it('200 partner-admin approves', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    vi.mocked(approveStatement).mockResolvedValue({ ...stubStatement, status: 'approved' } as any);
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(200);
  });

  it('409 duplicate approve (LIFECYCLE_VIOLATION)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    vi.mocked(approveStatement).mockRejectedValue(new Error('LIFECYCLE_VIOLATION: already approved'));
    const res = await PATCH(jsonReq({ action: 'approve' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(409);
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
    vi.mocked(markStatementPaid).mockResolvedValue({ ...stubStatement, status: 'paid' } as any);
    const res = await PATCH(jsonReq({ action: 'markPaid' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(200);
  });

  it('400 unknown action', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerAdminSession);
    const res = await PATCH(jsonReq({ action: 'badAction' }, 'PATCH'), ctx('s1'));
    expect(res.status).toBe(400);
  });
});
