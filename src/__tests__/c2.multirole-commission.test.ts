import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * C2 (§3.5/§21) — мультироль и активный контекст.
 *
 * Один человек может быть и партнёром (со ставкой), и сотрудником организации.
 * Когда активный контекст сессии = «организация» (`role: 'organization'`),
 * комиссия скрыта ПОЛНОСТЬЮ — даже если у того же `User` есть `partnerId` со
 * ставкой. Причина: экран кабинета организации можно показывать работодателю.
 *
 * Механизм — гейт по активному `session.role`, а НЕ по объединению ролей:
 * `requirePartner` отвергает любой role≠'partner' ещё до взгляда на partnerId.
 */

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/finance', () => ({
  getFinanceKpis: vi.fn(),
  listStatements: vi.fn(),
  getStatementWithItems: vi.fn(),
}));
vi.mock('@/lib/services/commission/statement', () => ({ calculateStatementForPartner: vi.fn() }));
vi.mock('@/lib/services/commission/lifecycle', () => ({ approveStatement: vi.fn(), markStatementPaid: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { commissionStatement: { findFirst: vi.fn() } } }));

import { getSession } from '@/lib/auth/session';
import { requirePartner, requirePartnerAdmin } from '@/lib/auth/guard';
import { getFinanceKpis, listStatements, getStatementWithItems } from '@/lib/services/partner/finance';
import { GET as financeGET } from '@/app/api/partner/finance/route';
import { GET as statementGET } from '@/app/api/partner/finance/statements/[id]/route';
import type { SessionPayload } from '@/lib/auth/jwt';

// The same human, in ORGANIZATION context, but who ALSO has a partner account
// with a commission rate. Active context wins: this is an org session.
const multiroleOrgContext = {
  sub: 'u-multi',
  role: 'organization',
  organizationId: 'org-1',
  organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'admin', isActive: true }],
  partnerId: 'p-1',          // <- has a partner identity…
  partnerRole: 'admin',      // …even partner-admin…
} as unknown as SessionPayload;

function getReq(url = 'http://x/') { return new Request(url); }
function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

describe('C2 — guards reject the partner identity while in organization context', () => {
  it('requirePartner is NOT ok for an org-context session (even with partnerId set)', () => {
    const r = requirePartner(multiroleOrgContext);
    expect(r.ok).toBe(false);
  });

  it('requirePartnerAdmin is NOT ok for an org-context session (even with partnerRole=admin)', () => {
    const r = requirePartnerAdmin(multiroleOrgContext);
    expect(r.ok).toBe(false);
  });
});

describe('C2 — commission endpoints return 403 in organization context', () => {
  beforeEach(() => vi.resetAllMocks());

  it('GET /api/partner/finance → 403 (no commission KPIs/statements served)', async () => {
    vi.mocked(getSession).mockResolvedValue(multiroleOrgContext);
    const res = await financeGET(getReq());
    expect(res.status).toBe(403);
    // The commission services must never even be consulted in org context.
    expect(getFinanceKpis).not.toHaveBeenCalled();
    expect(listStatements).not.toHaveBeenCalled();
  });

  it('GET /api/partner/finance/statements/[id] → 403 (no statement body served)', async () => {
    vi.mocked(getSession).mockResolvedValue(multiroleOrgContext);
    const res = await statementGET(getReq(), ctx('stmt-1'));
    expect(res.status).toBe(403);
    expect(getStatementWithItems).not.toHaveBeenCalled();
  });

  it('the response carries no commission fields whatsoever', async () => {
    vi.mocked(getSession).mockResolvedValue(multiroleOrgContext);
    const res = await financeGET(getReq());
    const body = await res.json();
    const serialized = JSON.stringify(body).toLowerCase();
    expect(serialized).not.toContain('commission');
    expect(serialized).not.toContain('kpi');
    expect(serialized).not.toContain('rate');
  });
});
