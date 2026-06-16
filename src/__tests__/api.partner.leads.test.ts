import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/leads', () => ({
  listLeads: vi.fn(),
  createLead: vi.fn(),
  getLead: vi.fn(),
  withdrawLead: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    auditLog: { create: vi.fn().mockResolvedValue(undefined) }
  }
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

import { getSession } from '@/lib/auth/session';
import { listLeads, createLead, getLead, withdrawLead } from '@/lib/services/partner/leads';
import { GET, POST } from '@/app/api/partner/leads/route';
import { GET as GET_ONE, PATCH } from '@/app/api/partner/leads/[id]/route';

const partnerSession = {
  sub: 'u-1', role: 'partner', partnerId: 'p1', partnerRole: 'manager', assignedOrgIds: []
} as any;

const scopedSession = {
  sub: 'u-2', role: 'partner', partnerId: 'p1', partnerRole: 'manager', assignedOrgIds: ['oA']
} as any;

const orgSession = { sub: 'u', role: 'organization', organizationId: 'o' } as any;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonReq(b: unknown, method = 'POST') {
  return new Request('http://x/', {
    method,
    body: JSON.stringify(b),
    headers: { 'content-type': 'application/json' }
  });
}

function getReq(query = '') {
  return new Request(`http://x/api/partner/leads${query}`);
}

describe('GET /api/partner/leads — feature flag disabled', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.FEATURE_PARTNER_LEADS = '0';
  });
  afterEach(() => { delete process.env.FEATURE_PARTNER_LEADS; });

  it('GET returns 404 when partner_leads flag is off', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(404);
  });

  it('POST returns 404 when partner_leads flag is off', async () => {
    const res = await POST(jsonReq({
      clientCompanyName: 'ООО Тест',
      clientContactName: 'Иван',
      subject: 'Обучение'
    }));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/partner/leads', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it('403 for non-partner role', async () => {
    vi.mocked(getSession).mockResolvedValue(orgSession);
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });

  it('lists leads with partner scope', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(listLeads).mockResolvedValue({ rows: [], total: 0, countsByStatus: {} });

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(listLeads).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      partnerId: 'p1',
      scopeOrgIds: undefined,
      take: 25,
      skip: 0
    }));
  });

  it('passes scopeOrgIds when manager has scope', async () => {
    vi.mocked(getSession).mockResolvedValue(scopedSession);
    vi.mocked(listLeads).mockResolvedValue({ rows: [], total: 0, countsByStatus: {} });

    await GET(getReq());
    expect(listLeads).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scopeOrgIds: ['oA']
    }));
  });

  it('parses status filter from query', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(listLeads).mockResolvedValue({ rows: [], total: 0, countsByStatus: {} });

    await GET(getReq('?status=qualified'));
    expect(listLeads).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: 'qualified'
    }));
  });

  it('ignores invalid status', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(listLeads).mockResolvedValue({ rows: [], total: 0, countsByStatus: {} });

    await GET(getReq('?status=garbage'));
    expect(listLeads).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: undefined
    }));
  });

  it('clamps take to MAX_TAKE', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(listLeads).mockResolvedValue({ rows: [], total: 0, countsByStatus: {} });

    await GET(getReq('?take=9999'));
    expect(listLeads).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      take: 100
    }));
  });

  it('uses DEFAULT_TAKE when take=0 (non-positive → fallback branch)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(listLeads).mockResolvedValue({ rows: [], total: 0, countsByStatus: {} });

    await GET(getReq('?take=0'));
    expect(listLeads).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      take: 25  // DEFAULT_TAKE
    }));
  });

  it('uses skip=0 when skip=-1 (negative → fallback branch)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(listLeads).mockResolvedValue({ rows: [], total: 0, countsByStatus: {} });

    await GET(getReq('?skip=-1'));
    expect(listLeads).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      skip: 0
    }));
  });
});

describe('POST /api/partner/leads', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(401);
  });

  it('403 for non-partner role in POST', async () => {
    vi.mocked(getSession).mockResolvedValue(orgSession);
    const res = await POST(jsonReq({
      clientCompanyName: 'ООО Тест',
      clientContactName: 'Иван',
      subject: 'Обучение'
    }));
    expect(res.status).toBe(403);
  });

  it('400 on missing required fields', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    const res = await POST(jsonReq({ clientCompanyName: '' }));
    expect(res.status).toBe(400);
  });

  it('201 on success and audit-logs the create', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(createLead).mockResolvedValue({ id: 'lead-1', status: 'new', clientCompanyName: 'X', subject: 'S' } as any);

    const res = await POST(jsonReq({
      clientCompanyName: 'ООО Тест',
      clientContactName: 'Иван',
      subject: 'Обучение',
      productType: ['training']
    }));
    expect(res.status).toBe(201);
    expect(createLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      partnerId: 'p1',
      createdByUserId: 'u-1',
      clientCompanyName: 'ООО Тест',
      productType: ['training']
    }));
  });

  it('422 when organizationId outside scope', async () => {
    vi.mocked(getSession).mockResolvedValue(scopedSession);

    const res = await POST(jsonReq({
      organizationId: 'oOutside',
      clientCompanyName: 'X',
      clientContactName: 'Y',
      subject: 'Z'
    }));
    expect(res.status).toBe(422);
  });

  it('422 propagates ORG_OUT_OF_SCOPE from service', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(createLead).mockRejectedValue(new Error('ORG_OUT_OF_SCOPE'));

    const res = await POST(jsonReq({
      organizationId: 'o-bad',
      clientCompanyName: 'X',
      clientContactName: 'Y',
      subject: 'Z'
    }));
    expect(res.status).toBe(422);
  });

  it('rethrows non-ORG_OUT_OF_SCOPE errors from createLead (throw err branch)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(createLead).mockRejectedValue(new Error('DB_DEADLOCK: cannot acquire lock'));

    await expect(POST(jsonReq({
      clientCompanyName: 'X',
      clientContactName: 'Y',
      subject: 'Z'
    }))).rejects.toThrow('DB_DEADLOCK');
  });

  it('non-Error throw in createLead → msg="unknown" → rethrows (covers String(err) branch)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(createLead).mockRejectedValue('plain string error');

    await expect(POST(jsonReq({
      clientCompanyName: 'X',
      clientContactName: 'Y',
      subject: 'Z'
    }))).rejects.toBe('plain string error');
  });
});

describe('GET /api/partner/leads (missing assignedOrgIds → undefined fallback)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('GET passes undefined scope when session.assignedOrgIds is null (falsy → ?? undefined)', async () => {
    // assignedOrgIds is null/undefined → session.assignedOrgIds && ... is falsy → scope=undefined
    const sessionNoOrgs = { ...partnerSession, assignedOrgIds: null } as any;
    vi.mocked(getSession).mockResolvedValue(sessionNoOrgs);
    vi.mocked(listLeads).mockResolvedValue({ rows: [], total: 0, countsByStatus: {} });

    await GET(getReq());
    expect(listLeads).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scopeOrgIds: undefined
    }));
  });
});

describe('GET /api/partner/leads/[id] — guards', () => {
  beforeEach(() => vi.resetAllMocks());

  it('404 when partner_leads flag is off', async () => {
    process.env.FEATURE_PARTNER_LEADS = '0';
    const res = await GET_ONE(new Request('http://x/'), ctx('l1'));
    expect(res.status).toBe(404);
    delete process.env.FEATURE_PARTNER_LEADS;
  });

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET_ONE(new Request('http://x/'), ctx('l1'));
    expect(res.status).toBe(401);
  });

  it('403 when session is not partner role', async () => {
    vi.mocked(getSession).mockResolvedValue(orgSession);
    const res = await GET_ONE(new Request('http://x/'), ctx('l1'));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/partner/leads/[id]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('404 when lead not found in scope', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(getLead).mockResolvedValue(null);

    const res = await GET_ONE(new Request('http://x/'), ctx('missing'));
    expect(res.status).toBe(404);
  });

  it('200 with lead body', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(getLead).mockResolvedValue({ id: 'lead-1', status: 'new' } as any);

    const res = await GET_ONE(new Request('http://x/'), ctx('lead-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('lead-1');
  });

  it('200 with lead — scopedSession passes assignedOrgIds as scopeOrgIds (covers TRUE branch L29)', async () => {
    // scopedSession has assignedOrgIds: ['oA'] → length > 0 → TRUE branch evaluates session.assignedOrgIds
    vi.mocked(getSession).mockResolvedValue(scopedSession);
    vi.mocked(getLead).mockResolvedValue({ id: 'lead-scoped', status: 'new' } as any);

    const res = await GET_ONE(new Request('http://x/'), ctx('lead-scoped'));
    expect(res.status).toBe(200);
    expect(getLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scopeOrgIds: ['oA']
    }));
  });
});

describe('PATCH /api/partner/leads/[id] — guards & additional branches', () => {
  beforeEach(() => vi.resetAllMocks());

  it('404 when partner_leads flag is off', async () => {
    process.env.FEATURE_PARTNER_LEADS = '0';
    const res = await PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('l'));
    expect(res.status).toBe(404);
    delete process.env.FEATURE_PARTNER_LEADS;
  });

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('l'));
    expect(res.status).toBe(401);
  });

  it('403 when session is not partner role', async () => {
    vi.mocked(getSession).mockResolvedValue(orgSession);
    const res = await PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('l'));
    expect(res.status).toBe(403);
  });

  it('400 when body json parse fails', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    const badReq = new Request('http://x/', { method: 'PATCH', body: 'NOT JSON', headers: { 'content-type': 'application/json' } });
    const res = await PATCH(badReq, ctx('l'));
    expect(res.status).toBe(400);
  });

  it('409 on ALREADY_REJECTED', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(withdrawLead).mockRejectedValue(new Error('ALREADY_REJECTED: already withdrawn'));
    const res = await PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('l'));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('ALREADY_REJECTED');
  });

  it('200 on withdraw with scoped session — assignedOrgIds passed as scopeOrgIds (covers TRUE branch L65)', async () => {
    // scopedSession has assignedOrgIds: ['oA'] → length > 0 → TRUE branch evaluates session.assignedOrgIds
    vi.mocked(getSession).mockResolvedValue(scopedSession);
    vi.mocked(withdrawLead).mockResolvedValue({ id: 'lead-s', status: 'rejected', rejectedReason: null } as any);

    const res = await PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('lead-s'));
    expect(res.status).toBe(200);
    expect(withdrawLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scopeOrgIds: ['oA']
    }));
  });
});

describe('PATCH /api/partner/leads/[id]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('400 on invalid action', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    const res = await PATCH(jsonReq({ action: 'nope' }, 'PATCH'), ctx('l'));
    expect(res.status).toBe(400);
  });

  it('200 on withdraw (with non-null rejectedReason)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(withdrawLead).mockResolvedValue({ id: 'l', status: 'rejected', rejectedReason: 'Отозван партнёром' } as any);

    const res = await PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('l'));
    expect(res.status).toBe(200);
    expect(withdrawLead).toHaveBeenCalled();
  });

  it('200 on withdraw with null rejectedReason (?? undefined fallback in audit)', async () => {
    // When rejectedReason is null → lead.rejectedReason ?? undefined = undefined
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(withdrawLead).mockResolvedValue({ id: 'l', status: 'rejected', rejectedReason: null } as any);

    const res = await PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('l'));
    expect(res.status).toBe(200);
  });

  it('PATCH with null assignedOrgIds → undefined scope (falsy && short-circuit)', async () => {
    // session.assignedOrgIds is null → && short-circuits → scope = undefined
    const sessionNoOrgs = { ...partnerSession, assignedOrgIds: null } as any;
    vi.mocked(getSession).mockResolvedValue(sessionNoOrgs);
    vi.mocked(withdrawLead).mockResolvedValue({ id: 'l', status: 'rejected', rejectedReason: null } as any);

    const res = await PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('l'));
    expect(res.status).toBe(200);
    expect(withdrawLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scopeOrgIds: undefined
    }));
  });

  it('rethrows unknown errors from withdrawLead (not NOT_FOUND/ALREADY_REJECTED/ALREADY_PROMOTED)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(withdrawLead).mockRejectedValue(new Error('DB_DEADLOCK: timeout'));

    await expect(PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('l'))).rejects.toThrow('DB_DEADLOCK');
  });

  it('non-Error throw in withdrawLead → msg="unknown" → rethrows', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(withdrawLead).mockRejectedValue('plain string rejection');

    await expect(PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('l'))).rejects.toBe('plain string rejection');
  });

  it('409 on ALREADY_PROMOTED', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(withdrawLead).mockRejectedValue(new Error('ALREADY_PROMOTED'));

    const res = await PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('l'));
    expect(res.status).toBe(409);
  });

  it('404 on NOT_FOUND', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession);
    vi.mocked(withdrawLead).mockRejectedValue(new Error('NOT_FOUND'));

    const res = await PATCH(jsonReq({ action: 'withdraw' }, 'PATCH'), ctx('l'));
    expect(res.status).toBe(404);
  });
});
