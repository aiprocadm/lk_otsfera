import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { commitImport } from '@/lib/services/import/commit-import';
import type { SessionPayload } from '@/lib/auth/jwt';

let prisma: PrismaClient;

// Unique stamp to avoid collisions with seed data or other test runs
const STAMP = Date.now();

// IDs created in setup, cleaned up in teardown
let companyId: string;
let partnerId: string;
let leaderUserId: string;
let plainManagerUserId: string;
let otherOrgId: string; // org outside plain manager's scope

// Unique INNs for this test run
const PARTNER_INN = `INN-P-${STAMP}`;
const TARGET_ORG_INN = `INN-O-${STAMP}`;
const OTHER_ORG_INN = `INN-OTHER-${STAMP}`;
const PAYMENT_EXT_ID = `PAY-${STAMP}`;

beforeAll(async () => {
  prisma = new PrismaClient();

  // Company
  const company = await prisma.company.create({ data: { name: `ImportCo-${STAMP}` } });
  companyId = company.id;

  // Partner with unique INN (needed for partnerInn match in import)
  const partner = await prisma.partner.create({
    data: { name: `ImportPartner-${STAMP}`, inn: PARTNER_INN },
  });
  partnerId = partner.id;

  // Leader manager user (managerRole='leader' => importScope returns unscoped)
  const leader = await prisma.user.create({
    data: {
      email: `leader-${STAMP}@import.test`,
      name: `Leader-${STAMP}`,
      role: 'manager',
      managerRole: 'leader',
      companyId,
    },
  });
  leaderUserId = leader.id;

  // Plain manager user (no managerRole, no managedOrgIds => scoped to nothing by default)
  const plainMgr = await prisma.user.create({
    data: {
      email: `plain-mgr-${STAMP}@import.test`,
      name: `PlainMgr-${STAMP}`,
      role: 'manager',
      companyId,
    },
  });
  plainManagerUserId = plainMgr.id;

  // An org that exists but is NOT in plain manager's scope (used in cross-scope test)
  const otherOrg = await prisma.organization.create({
    data: {
      name: `OtherOrg-${STAMP}`,
      inn: OTHER_ORG_INN,
      companyId,
    },
  });
  otherOrgId = otherOrg.id;
});

afterAll(async () => {
  // Clean up in dependency order: payments, orders, orgs, partner users, users, partner, company
  await prisma.payment.deleteMany({ where: { externalId: { startsWith: `PAY-${STAMP}` } } });
  // Also clean up any payments on orgs we created
  await prisma.payment.deleteMany({
    where: { organization: { inn: { in: [TARGET_ORG_INN, OTHER_ORG_INN] } } },
  });
  await prisma.order.deleteMany({
    where: { organization: { inn: { in: [TARGET_ORG_INN, OTHER_ORG_INN] } } },
  });
  // Remove org users / managers before deleting orgs
  await prisma.organizationManager.deleteMany({
    where: { organization: { inn: { in: [TARGET_ORG_INN, OTHER_ORG_INN] } } },
  });
  await prisma.organizationUser.deleteMany({
    where: { organization: { inn: { in: [TARGET_ORG_INN, OTHER_ORG_INN] } } },
  });
  await prisma.organization.deleteMany({
    where: { inn: { in: [TARGET_ORG_INN, OTHER_ORG_INN] } },
  });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [leaderUserId, plainManagerUserId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [leaderUserId, plainManagerUserId] } } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

// ----- helpers ----------------------------------------------------------------

function leaderSession(): SessionPayload {
  return {
    sub: leaderUserId,
    role: 'manager',
    managerRole: 'leader',
    companyId,
  };
}

function plainManagerSession(managedOrgIds: string[] = []): SessionPayload {
  return {
    sub: plainManagerUserId,
    role: 'manager',
    companyId,
    managedOrgIds,
  };
}

// ----- tests ------------------------------------------------------------------

describe('commitImport — transactional commit + audit', () => {
  it('leader imports org (linked to partner via INN) + payment → applied.paymentsUpserted === 1 and org is created', async () => {
    const session = leaderSession();

    const result = await commitImport(prisma, session, {
      orgs: [{ name: `TargetOrg-${STAMP}`, inn: TARGET_ORG_INN, partnerInn: PARTNER_INN }],
      orders: [],
      payments: [
        {
          externalId: PAYMENT_EXT_ID,
          orgInn: TARGET_ORG_INN,
          amount: 12345.67,
          paidAt: '2026-06-01',
          method: 'bank',
          isRefund: false,
          note: 'test payment',
        },
      ],
    });

    expect(result.applied.paymentsUpserted).toBe(1);
    expect(result.applied.orgsCreated).toBe(1);
    expect(result.skipped.payments).toHaveLength(0);

    // Verify the org was actually created and linked to the partner
    const org = await prisma.organization.findUnique({ where: { inn: TARGET_ORG_INN } });
    expect(org).not.toBeNull();
    expect(org!.partnerId).toBe(partnerId);

    // Verify payment exists
    const payment = await prisma.payment.findUnique({ where: { externalId: PAYMENT_EXT_ID } });
    expect(payment).not.toBeNull();
    expect(payment!.organizationId).toBe(org!.id);
  });

  it('re-running the same import is idempotent — payment count stays 1', async () => {
    // Run the same rows again (same externalId → upsert, same INN → org upsert)
    const session = leaderSession();

    await commitImport(prisma, session, {
      orgs: [{ name: `TargetOrg-${STAMP}`, inn: TARGET_ORG_INN, partnerInn: PARTNER_INN }],
      orders: [],
      payments: [
        {
          externalId: PAYMENT_EXT_ID,
          orgInn: TARGET_ORG_INN,
          amount: 12345.67,
          paidAt: '2026-06-01',
          method: 'bank',
          isRefund: false,
          note: 'test payment',
        },
      ],
    });

    // Must still be exactly 1 row with this externalId
    const count = await prisma.payment.count({ where: { externalId: PAYMENT_EXT_ID } });
    expect(count).toBe(1);
  });

  it('cross-scope: plain manager without access to otherOrg writes nothing and the org+payment appear in skipped', async () => {
    // Plain manager has managedOrgIds = [] (no assigned orgs) → otherOrg is out of scope.
    // The import row targets OTHER_ORG_INN which already exists in DB as otherOrgId.
    const session = plainManagerSession([]); // empty → no orgs in scope

    const payExtId = `PAY-CROSS-${STAMP}`;

    const result = await commitImport(prisma, session, {
      // Trying to update an existing org outside scope → should be skipped
      orgs: [{ name: 'Sneaky update', inn: OTHER_ORG_INN, partnerInn: null }],
      orders: [],
      payments: [
        {
          externalId: payExtId,
          orgInn: OTHER_ORG_INN,
          amount: 9999,
          paidAt: '2026-06-02',
          method: 'bank',
          isRefund: false,
          note: null,
        },
      ],
    });

    // The org row should be skipped (out of scope)
    expect(result.skipped.orgs.length).toBeGreaterThan(0);
    // The payment row should be skipped (org not writable)
    expect(result.skipped.payments.length).toBeGreaterThan(0);

    // Verify NOTHING was written for the out-of-scope org
    const orgAfter = await prisma.organization.findUnique({ where: { id: otherOrgId } });
    // Org should still exist (we created it in setup) but its name must NOT be 'Sneaky update'
    expect(orgAfter).not.toBeNull();
    expect(orgAfter!.name).not.toBe('Sneaky update');

    // No payment should have been created with this externalId
    const payCount = await prisma.payment.count({ where: { externalId: payExtId } });
    expect(payCount).toBe(0);

    // applied should show nothing written
    expect(result.applied.paymentsUpserted).toBe(0);
    expect(result.applied.orgsCreated).toBe(0);
    expect(result.applied.orgsUpdated).toBe(0);
  });
});
