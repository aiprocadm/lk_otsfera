/**
 * Track E / E1 — coverage restoration for the admin partner/org services and the
 * manager invite/card/messages/orderDetail/leadLifecycle services + managerPolicy.
 *
 * This file targets the EXACT residual uncovered lines/branches that drifted below
 * 100% after later feature tracks merged. Each block below names the file + the
 * line/branch it closes. It mirrors the mocks/style of the module's existing tests:
 *   - services.admin.partners.test.ts / services.admin.organizations.test.ts
 *     (mocked-prisma unit style, recordAudit/createInviteToken hoisted mocks)
 *   - services.manager.invite.test.ts (§3 boundary-catch contract)
 *   - services.organizationCard.integration.test.ts (live Postgres aggregation)
 *   - services.manager.messages.unit.test.ts / orderDetail.unit.test.ts /
 *     leadLifecycle.unit.test.ts (mocked-prisma branch coverage)
 *   - auth.managerPolicy(.profile).unit.test.ts (pure-function scope resolver)
 *
 * The file contains `new PrismaClient(` (organizationCard aggregation needs a real
 * DB), so it self-classifies as integration-tier per CLAUDE.md §6. The remaining
 * mocked-prisma branches run in the same partition without touching Postgres.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

// Hoisted mocks shared by the admin (recordAudit/createInviteToken) and the
// leadLifecycle (recordAudit/notifyPartnerUsers) service call paths. None of the
// modules exercised via the live PrismaClient (organizationCard) import these, so
// the module-level mocks do not perturb the integration aggregation below.
const { recordAuditMock, createInviteTokenMock, notifyPartnerUsersMock } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  createInviteTokenMock: vi.fn().mockResolvedValue({ token: 'tok', expiresAt: new Date() }),
  notifyPartnerUsersMock: vi.fn()
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/auth/passwordReset', () => ({ createInviteToken: createInviteTokenMock }));
vi.mock('@/lib/notifications/partner', () => ({ notifyPartnerUsers: notifyPartnerUsersMock }));

import {
  updatePartner,
  deactivatePartner,
  reactivatePartner,
  createPartnerWithAdmin
} from '@/lib/services/admin/partners';
import { updateOrganization } from '@/lib/services/admin/organizations';
import { createAndAssignManager } from '@/lib/services/manager/invite';
import { getOrganizationCard } from '@/lib/services/manager/organizationCard';
import { listIncomingComments } from '@/lib/services/manager/messages';
import { loadManagerOrderDetail } from '@/lib/services/manager/orderDetail';
import { setLeadStatus, promoteLead, rejectLead } from '@/lib/services/manager/leadLifecycle';
import { managerOrgScope } from '@/lib/auth/managerPolicy';

// A prisma whose $transaction rejects with a NON-domain error, so the service's
// try/catch hits `throw e` (the re-throw arm) instead of mapping a code.
function txThrows(err: unknown): PrismaClient {
  return {
    $transaction: vi.fn().mockRejectedValue(err)
  } as unknown as PrismaClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// admin/partners.ts — catch re-throw arms + null-commissionRate rate-change path
// ─────────────────────────────────────────────────────────────────────────────
describe('admin/partners — boundary-catch re-throws non-domain errors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updatePartner re-throws a non-AdminPartnerError (branch@215, lines216-217)', async () => {
    const boom = new Error('db exploded');
    await expect(updatePartner(txThrows(boom), 'actor1', 'p1', { name: 'X' })).rejects.toThrow('db exploded');
  });

  it('deactivatePartner re-throws a non-AdminPartnerError (branch@243, lines244-245)', async () => {
    const boom = new Error('conn reset');
    await expect(deactivatePartner(txThrows(boom), 'actor1', 'p1')).rejects.toThrow('conn reset');
  });

  it('reactivatePartner re-throws a non-AdminPartnerError (branch@271, lines272-273)', async () => {
    const boom = new Error('deadlock');
    await expect(reactivatePartner(txThrows(boom), 'actor1', 'p1')).rejects.toThrow('deadlock');
  });

  it('createPartnerWithAdmin re-throws a non-AdminPartnerError (branch@371, lines372-373)', async () => {
    const boom = new Error('unique violation not mapped');
    await expect(
      createPartnerWithAdmin(txThrows(boom), 'actor1', {
        name: 'N',
        slug: 's',
        adminEmail: 'a@t.local',
        adminName: 'A'
      })
    ).rejects.toThrow('unique violation not mapped');
  });
});

describe('admin/partners — rate change from a null prior rate', () => {
  beforeEach(() => vi.clearAllMocks());

  // Covers updatePartner branch@183 (`before.commissionRate ?? new Prisma.Decimal(0)`
  // null arm) AND branch@187 (`oldRate: before.commissionRate ?? null` null arm):
  // a partner whose stored rate is null now receives a non-zero rate, so a
  // CommissionRateChange row is written with oldRate=null.
  it('writes a CommissionRateChange with oldRate=null when the prior rate was null', async () => {
    const before = { name: 'Partner', commissionRate: null, isActive: true };
    const updated = { id: 'p1', name: 'Partner', commissionRate: new Prisma.Decimal('0.05'), isActive: true };
    const tx = {
      partner: {
        findUnique: vi.fn().mockResolvedValue(before),
        update: vi.fn().mockResolvedValue(updated)
      },
      commissionRateChange: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    } as unknown as PrismaClient;

    const result = await updatePartner(prisma, 'actor-x', 'p1', { commissionRate: 0.05 });
    expect(result).toEqual({ ok: true });

    expect(tx.commissionRateChange.create).toHaveBeenCalledTimes(1);
    const createCall = tx.commissionRateChange.create.mock.calls[0][0];
    // oldRate is the `?? null` fallback, newRate is the incoming Decimal.
    expect(createCall.data.oldRate).toBeNull();
    expect(createCall.data.newRate.equals(new Prisma.Decimal('0.05'))).toBe(true);
    expect(createCall.data.partnerId).toBe('p1');
    expect(createCall.data.changedById).toBe('actor-x');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// admin/organizations.ts — catch re-throw arm (branch@162, lines163-164)
// ─────────────────────────────────────────────────────────────────────────────
describe('admin/organizations — boundary-catch re-throws non-domain errors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updateOrganization re-throws a non-AdminOrgError', async () => {
    const boom = new Error('org tx failed');
    await expect(updateOrganization(txThrows(boom), 'actor1', 'org1', { name: 'X' })).rejects.toThrow('org tx failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// manager/invite.ts — catch re-throw arm (branch@175, lines176-177)
// ─────────────────────────────────────────────────────────────────────────────
describe('manager/invite — boundary-catch re-throws non-domain errors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createAndAssignManager re-throws a non-ManagerInviteError', async () => {
    const boom = new Error('invite tx failed');
    await expect(
      createAndAssignManager(txThrows(boom), { mode: 'existing', organizationId: 'org1', email: 'a@t.local' }, 'actor1')
    ).rejects.toThrow('invite tx failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// manager/messages.ts — accessProfile.threads path (branch@56, line57)
// ─────────────────────────────────────────────────────────────────────────────
describe('manager/messages — profile threads-level order scope', () => {
  beforeEach(() => vi.clearAllMocks());

  // The existing unit test only exercises the no-profile branch (managerOrderScope).
  // A session carrying accessProfile takes `orderWhereForLevel(session, threads)`.
  it('uses orderWhereForLevel(threads) when the session has an access profile', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      comment: { findMany },
      company: { findUnique: vi.fn().mockResolvedValue({ managerTeamVisibility: false }) }
    } as unknown as PrismaClient;

    const session = {
      sub: 'mgr-1',
      role: 'manager',
      companyId: 'co-1',
      managedOrgIds: ['org-1'],
      accessProfile: {
        id: 'ap1',
        name: 'Роль',
        orders: 'all',
        organizations: 'all',
        threads: 'own',
        documents: 'all',
        finance: 'all',
        leads: 'all',
        tasks: 'all',
        capabilities: []
      }
    } as unknown as SessionPayload;

    await listIncomingComments(prisma, { session });

    const where = findMany.mock.calls[0][0].where;
    // threads='own' → company-floor AND managerId==sub (real orderWhereForLevel).
    expect(where.order).toEqual({ AND: [{ companyId: 'co-1' }, { managerId: 'mgr-1' }] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// manager/orderDetail.ts — itemsResult NOT ok → items=[] (branch@67)
// ─────────────────────────────────────────────────────────────────────────────
const { getOrderMock, listOrderItemsMock } = vi.hoisted(() => ({
  getOrderMock: vi.fn(),
  listOrderItemsMock: vi.fn()
}));
vi.mock('@/lib/services/manager/orders', () => ({ getOrder: getOrderMock }));
vi.mock('@/lib/services/training', () => ({ listOrderItems: listOrderItemsMock }));

describe('manager/orderDetail — items fallback when listOrderItems fails', () => {
  beforeEach(() => vi.clearAllMocks());

  // Existing unit test always returns { ok: true }. When listOrderItems returns
  // a §3 failure, the `: []` arm of `itemsResult.ok ? … : []` is taken.
  it('yields an empty items array when listOrderItems returns { ok: false }', async () => {
    getOrderMock.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'A-1',
      title: 'Заказ',
      documents: []
    } as never);
    listOrderItemsMock.mockResolvedValue({ ok: false, error: 'forbidden' });

    const prisma = {
      auditLog: { findMany: vi.fn().mockResolvedValue([]) },
      comment: { findMany: vi.fn().mockResolvedValue([]) }
    } as unknown as PrismaClient;

    const session = { sub: 'mgr-1', role: 'manager', managedOrgIds: ['org-1'], companyId: 'co-1' } as SessionPayload;
    const result = await loadManagerOrderDetail(prisma, session, 'order-1');

    expect(result).not.toBeNull();
    expect(result!.items).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// manager/leadLifecycle.ts — not_found (null lead) arms for setLeadStatus /
// promoteLead / rejectLead (branches@86, @115, @166)
// ─────────────────────────────────────────────────────────────────────────────
function leadDbNull(): PrismaClient {
  return {
    lead: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() }
  } as unknown as PrismaClient;
}

describe('manager/leadLifecycle — not_found when the lead is missing', () => {
  beforeEach(() => {
    recordAuditMock.mockReset();
    notifyPartnerUsersMock.mockReset();
  });

  it('setLeadStatus returns not_found for a missing lead (branch@86)', async () => {
    const r = await setLeadStatus(leadDbNull(), { leadId: 'missing', managerId: 'm1', status: 'in_review' });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('promoteLead returns not_found for a missing lead (branch@115)', async () => {
    const r = await promoteLead(leadDbNull(), { leadId: 'missing', managerId: 'm1' });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('rejectLead returns not_found for a missing lead (branch@166)', async () => {
    const r = await rejectLead(leadDbNull(), { leadId: 'missing', managerId: 'm1', reason: 'x' });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth/managerPolicy.ts — company-floor sentinel under a profile (branch@111)
// ─────────────────────────────────────────────────────────────────────────────
describe('auth/managerPolicy — managerOrgScope profile floor without companyId', () => {
  // Existing profile tests always carry companyId:'co-1'. When a profiled session
  // has NO companyId, the `?? NO_COMPANY_SENTINEL` arm of line 111 is taken.
  it('falls back to the never-match sentinel when a profiled session lacks companyId', () => {
    const session = {
      sub: 'u1',
      role: 'manager',
      managedOrgIds: ['o1'],
      accessProfile: {
        id: 'ap1',
        name: 'Роль',
        orders: 'all',
        organizations: 'all',
        threads: 'all',
        documents: 'all',
        finance: 'all',
        leads: 'all',
        tasks: 'all',
        capabilities: []
      }
    } as unknown as SessionPayload; // no companyId

    expect(managerOrgScope(session, false)).toEqual({ companyId: '__no_company__' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// manager/organizationCard.ts — INTEGRATION (live Postgres)
//   branch@63  : org lookup returns null  → early null (before the scope guard)
//   branch@103 : paidAgg._sum.amount ?? Decimal(0)   (no payments)
//   branch@104 : refundAgg._sum.amount ?? Decimal(0) (no refunds)
//   branch@132 : commission partnerCommissionRate null arm (leader sees commission,
//                 but the org has no override rate)
// ─────────────────────────────────────────────────────────────────────────────
describe('manager/organizationCard — residual aggregation branches (integration)', () => {
  let prisma: PrismaClient;
  const STAMP = Date.now();
  let companyId: string;
  let leaderId: string;
  let orgNoMoney: string;

  // Leader (has see_commission via managerRole=leader in legacy no-profile mode)
  // in a teamMode=OFF company, so visibility flows through canSeeOrganization
  // (managedOrgIds includes the org).
  const leaderSession = (): SessionPayload =>
    ({
      sub: leaderId,
      role: 'manager',
      managerRole: 'leader',
      companyId,
      managedOrgIds: [orgNoMoney]
    } as unknown as SessionPayload);

  beforeAll(async () => {
    prisma = new PrismaClient();
    companyId = (await prisma.company.create({ data: { name: `covAM-co-${STAMP}` } })).id;
    leaderId = (
      await prisma.user.create({
        data: { email: `covAM-leader-${STAMP}@t.local`, name: 'Leader', role: 'manager', managerRole: 'leader', companyId }
      })
    ).id;
    // Org with NO partnerCommissionRate override and NO payments/refunds — so both
    // aggregate `_sum.amount` come back null AND partnerCommissionRate is null.
    orgNoMoney = (
      await prisma.organization.create({
        data: { name: `covAM-org-${STAMP}`, companyId, partnerCommissionRate: null }
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgNoMoney } });
    await prisma.user.deleteMany({ where: { id: leaderId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it('returns null for a non-existent organization id (branch@63 !org arm)', async () => {
    const card = await getOrganizationCard(prisma, leaderSession(), `no-such-org-${STAMP}`);
    expect(card).toBeNull();
  });

  it('KPIs are "0.00" when the org has no payments or refunds (branches@103/@104)', async () => {
    const card = await getOrganizationCard(prisma, leaderSession(), orgNoMoney);
    expect(card).not.toBeNull();
    if (!card) return;
    expect(card.payments).toEqual([]);
    // paid − refunded == 0, both aggregate sums fell back to Decimal(0).
    expect(card.kpis.totalPaid).toBe('0.00');
    expect(card.kpis.totalRefunded).toBe('0.00');
  });

  it('commission.partnerCommissionRate is null when leader sees an org with no override rate (branch@132)', async () => {
    const card = await getOrganizationCard(prisma, leaderSession(), orgNoMoney);
    expect(card).not.toBeNull();
    if (!card) return;
    // Leader has see_commission (commission object present), but the org's rate is
    // null → the `: null` arm of the toFixed(4) conditional.
    expect(card.commission).not.toBeNull();
    expect(card.commission?.partnerCommissionRate).toBeNull();
  });
});
