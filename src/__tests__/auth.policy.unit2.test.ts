/**
 * Additional unit tests for src/lib/auth/policy.ts
 *
 * Covers branches not hit by existing integration tests:
 *  - isPartnerAdmin: true / false paths
 *  - canPartnerAccessOrg: non-partner role, no partnerId, org not found,
 *    wrong partnerId, assignedOrgIds scoping
 *  - partnerOrgScopeFilter: no partnerId, no scope, scoped
 *  - canAccessOrganization: null orgId, admin, partner variants, org role,
 *    student/unknown role
 *  - canReadOrder: admin, partner with/without match, org role
 *  - canReadDocument: partner channel pin, org channel pin, order-less branch,
 *    missing counterparty, re-fetch path, manager deny (no company)
 *
 * All db calls are mocked so no Postgres needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  organizationFindUnique,
  organizationFindMany,
  organizationFindFirst,
  orderFindUnique,
  documentFindUnique,
  commentCount,
  companyFindUnique,
  canSeeOrderMock,
  canSeeOrganizationMock,
  getCompanyTeamVisibilityMock,
  canReadOrderLessDocumentMock,
} = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  organizationFindMany: vi.fn(),
  organizationFindFirst: vi.fn(),
  orderFindUnique: vi.fn(),
  documentFindUnique: vi.fn(),
  commentCount: vi.fn(),
  companyFindUnique: vi.fn(),
  canSeeOrderMock: vi.fn(),
  canSeeOrganizationMock: vi.fn(),
  getCompanyTeamVisibilityMock: vi.fn(),
  canReadOrderLessDocumentMock: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: {
      findUnique: organizationFindUnique,
      findMany: organizationFindMany,
      findFirst: organizationFindFirst,
    },
    order: { findUnique: orderFindUnique },
    document: { findUnique: documentFindUnique },
    comment: { count: commentCount },
    company: { findUnique: companyFindUnique },
  },
}));

vi.mock('@/lib/auth/managerPolicy', () => ({
  canSeeOrder: canSeeOrderMock,
  canSeeOrganization: canSeeOrganizationMock,
  getCompanyTeamVisibility: getCompanyTeamVisibilityMock,
  isOrgInScope: vi.fn(),
  isLeaderSameCompany: vi.fn(),
}));

vi.mock('@/lib/auth/documentChannelPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/documentChannelPolicy')>();
  return {
    ...actual,
    canReadOrderLessDocument: canReadOrderLessDocumentMock,
    INFECTED_HIDDEN_WHERE: { scanStatus: { not: 'infected' } },
  };
});

import {
  isPartnerAdmin,
  canPartnerAccessOrg,
  partnerOrgScopeFilter,
  canAccessOrganization,
  canReadOrder,
  canReadDocument,
  forbiddenResponse,
} from '@/lib/auth/policy';
import type { SessionPayload } from '@/lib/auth/jwt';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN: SessionPayload = { sub: 'admin', role: 'admin' };
const PARTNER_ADMIN: SessionPayload = { sub: 'pa', role: 'partner', partnerId: 'p-1', partnerRole: 'admin' };
const PARTNER_MGR: SessionPayload = { sub: 'pm', role: 'partner', partnerId: 'p-1', partnerRole: 'manager' };
const PARTNER_NO_ID: SessionPayload = { sub: 'pni', role: 'partner' };
const ORG_USER: SessionPayload = { sub: 'ou', role: 'organization', organizationId: 'org-1' };
const MGR: SessionPayload = { sub: 'mgr', role: 'manager', companyId: 'co-1', managedOrgIds: ['org-1'] };
const STUDENT: SessionPayload = { sub: 'stu', role: 'student' };

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibilityMock.mockResolvedValue(false);
  canSeeOrderMock.mockReturnValue(false);
  canSeeOrganizationMock.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// forbiddenResponse
// ---------------------------------------------------------------------------

describe('forbiddenResponse', () => {
  it('returns 403 JSON response with default message', async () => {
    const r = forbiddenResponse();
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.code).toBe('FORBIDDEN');
    expect(body.message).toBe('Access denied');
  });

  it('accepts a custom message', async () => {
    const r = forbiddenResponse('Nope');
    const body = await r.json();
    expect(body.message).toBe('Nope');
  });
});

// ---------------------------------------------------------------------------
// isPartnerAdmin
// ---------------------------------------------------------------------------

describe('isPartnerAdmin', () => {
  it('returns true for partner with partnerRole=admin', () => {
    expect(isPartnerAdmin(PARTNER_ADMIN)).toBe(true);
  });

  it('returns false for partner with partnerRole=manager', () => {
    expect(isPartnerAdmin(PARTNER_MGR)).toBe(false);
  });

  it('returns false for admin role', () => {
    expect(isPartnerAdmin(ADMIN)).toBe(false);
  });

  it('returns false for org role', () => {
    expect(isPartnerAdmin(ORG_USER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canPartnerAccessOrg
// ---------------------------------------------------------------------------

describe('canPartnerAccessOrg', () => {
  it('returns false for non-partner role', async () => {
    expect(await canPartnerAccessOrg(ADMIN, 'org-1')).toBe(false);
  });

  it('returns false for partner with no partnerId', async () => {
    expect(await canPartnerAccessOrg(PARTNER_NO_ID, 'org-1')).toBe(false);
  });

  it('returns false when org not found', async () => {
    organizationFindUnique.mockResolvedValue(null);
    expect(await canPartnerAccessOrg(PARTNER_ADMIN, 'org-99')).toBe(false);
  });

  it('returns false when org belongs to a different partner', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'p-other' });
    expect(await canPartnerAccessOrg(PARTNER_ADMIN, 'org-1')).toBe(false);
  });

  it('returns true when org belongs to same partner and no scope restriction', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'p-1' });
    expect(await canPartnerAccessOrg(PARTNER_ADMIN, 'org-1')).toBe(true);
  });

  it('returns true when org is in assignedOrgIds scope', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'p-1' });
    const scoped: SessionPayload = { ...PARTNER_ADMIN, assignedOrgIds: ['org-1', 'org-2'] };
    expect(await canPartnerAccessOrg(scoped, 'org-1')).toBe(true);
  });

  it('returns false when org is not in assignedOrgIds scope', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'p-1' });
    const scoped: SessionPayload = { ...PARTNER_ADMIN, assignedOrgIds: ['org-2'] };
    expect(await canPartnerAccessOrg(scoped, 'org-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// partnerOrgScopeFilter
// ---------------------------------------------------------------------------

describe('partnerOrgScopeFilter', () => {
  it('returns deny-all filter when no partnerId', () => {
    const result = partnerOrgScopeFilter(PARTNER_NO_ID);
    expect(result).toEqual({ id: { in: [] } });
  });

  it('returns {partnerId} when assignedOrgIds is empty (all orgs for partner)', () => {
    const result = partnerOrgScopeFilter({ ...PARTNER_ADMIN, assignedOrgIds: [] });
    expect(result).toEqual({ partnerId: 'p-1' });
  });

  it('returns {partnerId, id:{in:[...]}} when assignedOrgIds has entries', () => {
    const result = partnerOrgScopeFilter({ ...PARTNER_ADMIN, assignedOrgIds: ['org-A', 'org-B'] });
    expect(result).toEqual({ partnerId: 'p-1', id: { in: ['org-A', 'org-B'] } });
  });

  it('returns {partnerId} when assignedOrgIds is undefined (treated as empty scope)', () => {
    const result = partnerOrgScopeFilter(PARTNER_ADMIN); // no assignedOrgIds key
    expect(result).toEqual({ partnerId: 'p-1' });
  });
});

// ---------------------------------------------------------------------------
// canAccessOrganization
// ---------------------------------------------------------------------------

describe('canAccessOrganization', () => {
  it('returns false for null organizationId', async () => {
    expect(await canAccessOrganization(ADMIN, null)).toBe(false);
  });

  it('returns false for undefined organizationId', async () => {
    expect(await canAccessOrganization(ADMIN, undefined)).toBe(false);
  });

  it('admin returns true for any valid orgId', async () => {
    expect(await canAccessOrganization(ADMIN, 'org-any')).toBe(true);
  });

  it('partner with no partnerId returns false', async () => {
    expect(await canAccessOrganization(PARTNER_NO_ID, 'org-1')).toBe(false);
  });

  it('partner with partnerId and matching org returns true', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'p-1' });
    expect(await canAccessOrganization(PARTNER_ADMIN, 'org-1')).toBe(true);
  });

  it('partner with partnerId but wrong org partner returns false', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'p-other' });
    expect(await canAccessOrganization(PARTNER_ADMIN, 'org-1')).toBe(false);
  });

  it('organization role: returns true when organizationId matches', async () => {
    expect(await canAccessOrganization(ORG_USER, 'org-1')).toBe(true);
  });

  it('organization role: returns false when organizationId does not match', async () => {
    expect(await canAccessOrganization(ORG_USER, 'org-other')).toBe(false);
  });

  it('manager in scoped mode: canSeeOrganization=true → true', async () => {
    getCompanyTeamVisibilityMock.mockResolvedValue(false);
    canSeeOrganizationMock.mockReturnValue(true);
    expect(await canAccessOrganization(MGR, 'org-1')).toBe(true);
  });

  it('manager in company-wide mode: same company org → true', async () => {
    getCompanyTeamVisibilityMock.mockResolvedValue(true);
    organizationFindUnique.mockResolvedValue({ companyId: 'co-1' });
    expect(await canAccessOrganization(MGR, 'org-1')).toBe(true);
  });

  it('manager in company-wide mode: different company org → false', async () => {
    getCompanyTeamVisibilityMock.mockResolvedValue(true);
    organizationFindUnique.mockResolvedValue({ companyId: 'co-other' });
    expect(await canAccessOrganization(MGR, 'org-1')).toBe(false);
  });

  it('student role returns false', async () => {
    expect(await canAccessOrganization(STUDENT, 'org-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canReadOrder
// ---------------------------------------------------------------------------

describe('canReadOrder', () => {
  const ORDER = { id: 'ord-1', companyId: 'co-1' };

  it('admin returns true', async () => {
    expect(await canReadOrder(ADMIN, ORDER)).toBe(true);
  });

  it('organization: returns false when no organizationId in session', async () => {
    const sess: SessionPayload = { sub: 'u', role: 'organization' };
    expect(await canReadOrder(sess, ORDER)).toBe(false);
  });

  it('organization: returns true when one of its orgs belongs to the order company', async () => {
    organizationFindMany.mockResolvedValue([{ id: 'org-1' }]);
    const sess = { ...ORG_USER, organizationId: 'org-1' };
    expect(await canReadOrder(sess, ORDER)).toBe(true);
  });

  it('organization: returns false when no org matches', async () => {
    organizationFindMany.mockResolvedValue([{ id: 'org-other' }]);
    expect(await canReadOrder(ORG_USER, ORDER)).toBe(false);
  });

  it('partner with no partnerId returns false', async () => {
    expect(await canReadOrder(PARTNER_NO_ID, ORDER)).toBe(false);
  });

  it('partner: returns true when org with matching partnerId + companyId exists', async () => {
    organizationFindFirst.mockResolvedValue({ id: 'org-1' });
    expect(await canReadOrder(PARTNER_ADMIN, ORDER)).toBe(true);
  });

  it('partner: returns false when no matching org exists', async () => {
    organizationFindFirst.mockResolvedValue(null);
    expect(await canReadOrder(PARTNER_ADMIN, ORDER)).toBe(false);
  });

  it('manager in scoped mode: order not found → false', async () => {
    getCompanyTeamVisibilityMock.mockResolvedValue(false);
    orderFindUnique.mockResolvedValue(null);
    expect(await canReadOrder(MGR, ORDER)).toBe(false);
  });

  it('manager in scoped mode: canSeeOrder=true → true', async () => {
    getCompanyTeamVisibilityMock.mockResolvedValue(false);
    orderFindUnique.mockResolvedValue({ id: 'ord-1', managerId: 'mgr', organizationId: 'org-1', companyId: 'co-1' });
    canSeeOrderMock.mockReturnValue(true);
    expect(await canReadOrder(MGR, ORDER)).toBe(true);
  });

  it('manager in company-wide mode: same company → true', async () => {
    getCompanyTeamVisibilityMock.mockResolvedValue(true);
    expect(await canReadOrder(MGR, { id: 'ord-1', companyId: 'co-1' })).toBe(true);
  });

  it('manager in company-wide mode: different company → false', async () => {
    getCompanyTeamVisibilityMock.mockResolvedValue(true);
    expect(await canReadOrder(MGR, { id: 'ord-1', companyId: 'co-other' })).toBe(false);
  });

  it('student role returns false', async () => {
    expect(await canReadOrder(STUDENT, ORDER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canReadDocument
// ---------------------------------------------------------------------------

describe('canReadDocument', () => {
  const FULL_PARTNER_DOC = {
    id: 'doc-1',
    orderId: 'ord-1',
    companyId: null as string | null,
    counterpartyType: 'partner' as const,
    counterpartyId: 'p-1',
    order: { companyId: 'co-1' },
  };

  const FULL_ORG_DOC = {
    id: 'doc-2',
    orderId: 'ord-2',
    companyId: null as string | null,
    counterpartyType: 'organization' as const,
    counterpartyId: 'org-1',
    order: { companyId: 'co-1' },
  };

  it('returns false when doc has no counterpartyType', async () => {
    // Doc without counterpartyType will hit the re-fetch path
    documentFindUnique.mockResolvedValue(null);
    const result = await canReadDocument(ADMIN, { id: 'doc-missing', orderId: null });
    expect(result).toBe(false);
  });

  it('returns false when re-fetched doc is null', async () => {
    documentFindUnique.mockResolvedValue(null);
    const result = await canReadDocument(ADMIN, { id: 'doc-missing', orderId: null });
    expect(result).toBe(false);
  });

  it('returns false when re-fetched doc has no counterpartyType', async () => {
    documentFindUnique.mockResolvedValue({
      id: 'd', orderId: null, companyId: null,
      counterpartyType: null, counterpartyId: null, order: null
    });
    const result = await canReadDocument(ADMIN, { id: 'd', orderId: null });
    expect(result).toBe(false);
  });

  it('partner: returns false when doc is for org channel, not partner', async () => {
    const result = await canReadDocument(PARTNER_ADMIN, FULL_ORG_DOC);
    expect(result).toBe(false);
  });

  it('partner: returns false when doc is for partner but different partnerId', async () => {
    const docWrongPartner = { ...FULL_PARTNER_DOC, counterpartyId: 'p-other' };
    const result = await canReadDocument(PARTNER_ADMIN, docWrongPartner);
    expect(result).toBe(false);
  });

  it('partner: proceeds to canReadOrder check when channel matches', async () => {
    // channel matches → canReadOrder → partner: organizationFindFirst returns match
    organizationFindFirst.mockResolvedValue({ id: 'org-1' });
    const result = await canReadDocument(PARTNER_ADMIN, FULL_PARTNER_DOC);
    expect(result).toBe(true);
  });

  it('org: returns false when doc is for partner channel', async () => {
    const result = await canReadDocument(ORG_USER, FULL_PARTNER_DOC);
    expect(result).toBe(false);
  });

  it('org: returns false when doc is for different org channel', async () => {
    const docOtherOrg = { ...FULL_ORG_DOC, counterpartyId: 'org-other' };
    const result = await canReadDocument(ORG_USER, docOtherOrg);
    expect(result).toBe(false);
  });

  it('org: proceeds to canReadOrder when channel matches', async () => {
    organizationFindMany.mockResolvedValue([{ id: 'org-1' }]);
    const result = await canReadDocument(ORG_USER, FULL_ORG_DOC);
    expect(result).toBe(true);
  });

  it('admin: returns true for order-bound doc', async () => {
    const result = await canReadDocument(ADMIN, FULL_PARTNER_DOC);
    expect(result).toBe(true);
  });

  it('returns false when order-bound but order has no companyId (re-fetch not needed)', async () => {
    // Use doc.companyId to make haveAll=true (no re-fetch), orderId non-null → order-bound,
    // but order is null → doc.order?.companyId is undefined → falsy → L116 fires → returns false.
    // haveAll = !!counterpartyType && !!counterpartyId && (!!order?.companyId || !!companyId)
    //         = true              && true               && (false              || true)
    //         = true  → no re-fetch. Then orderId non-null → order-bound. Then L116 triggers.
    const docOrderBoundNoCompany = {
      id: 'doc-no-company',
      orderId: 'ord-x',       // non-null → order-bound branch
      companyId: 'co-1',      // keeps haveAll=true without needing order.companyId
      counterpartyType: 'partner' as const,
      counterpartyId: 'p-1',
      order: null,             // null → doc.order?.companyId = undefined → falsy → L116 return false
    };
    const result = await canReadDocument(ADMIN, docOrderBoundNoCompany);
    expect(result).toBe(false);
  });

  it('order-less branch: delegates to canReadOrderLessDocument', async () => {
    canReadOrderLessDocumentMock.mockReturnValue(true);
    const orderlessDoc = {
      id: 'doc-ol',
      orderId: null,
      companyId: 'co-1',
      counterpartyType: 'partner' as const,
      counterpartyId: 'p-1',
      order: null,
    };
    const result = await canReadDocument(PARTNER_ADMIN, orderlessDoc);
    expect(result).toBe(true);
    expect(canReadOrderLessDocumentMock).toHaveBeenCalledWith(
      PARTNER_ADMIN,
      expect.objectContaining({ counterpartyType: 'partner', counterpartyId: 'p-1' })
    );
  });

  it('re-fetch path: when doc lacks counterpartyType/Id, fetches from db', async () => {
    documentFindUnique.mockResolvedValue({
      id: 'doc-rf',
      orderId: 'ord-rf',
      companyId: null,
      counterpartyType: 'partner',
      counterpartyId: 'p-1',
      order: { companyId: 'co-1' }
    });
    organizationFindFirst.mockResolvedValue({ id: 'org-1' });
    // Provide a doc missing the fields that trigger re-fetch (no counterpartyType)
    const result = await canReadDocument(PARTNER_ADMIN, { id: 'doc-rf', orderId: null });
    expect(documentFindUnique).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it('order-less branch: re-fetched doc has null companyId → passed as null to canReadOrderLessDocument', async () => {
    canReadOrderLessDocumentMock.mockReturnValue(false);
    // Re-fetch returns a doc with orderId=null and companyId=null
    documentFindUnique.mockResolvedValue({
      id: 'doc-ol-null',
      orderId: null,
      companyId: null, // null → arm0 of ?? null in canReadDocument L111
      counterpartyType: 'organization',
      counterpartyId: 'org-1',
      order: null,
    });
    // Provide a minimal doc that triggers re-fetch (missing counterpartyType to force db lookup)
    const result = await canReadDocument(ORG_USER, { id: 'doc-ol-null', orderId: null });
    expect(documentFindUnique).toHaveBeenCalledOnce();
    expect(canReadOrderLessDocumentMock).toHaveBeenCalledWith(
      ORG_USER,
      expect.objectContaining({ companyId: null })
    );
    expect(result).toBe(false);
  });
});
