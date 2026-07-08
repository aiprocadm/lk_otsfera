import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listCalls } from '@/lib/services/telephony/listCalls';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * IDOR regression: manager A must NEVER see company B's calls via
 * `listCalls`, in either `items` or `total`. Mirrors
 * `security.idor-comments.integration.test.ts` — this is the load-bearing
 * cross-tenant isolation check for the calls journal (Task 9a).
 */

const prisma = new PrismaClient();
const STAMP = `idorcall${Date.now()}`;

function managerSession(companyId: string): SessionPayload {
  return {
    sub: `${STAMP}-mgr-a`,
    role: 'manager',
    email: 'mgr-a@local',
    companyId,
    managedOrgIds: [],
  } as unknown as SessionPayload;
}

describe('IDOR: listCalls company isolation', () => {
  let companyA: { id: string };
  let companyB: { id: string };
  let callA: { id: string };
  let callB: { id: string };
  let callUnresolved: { id: string };

  beforeAll(async () => {
    companyA = await prisma.company.create({ data: { name: `${STAMP}-coA` } });
    companyB = await prisma.company.create({ data: { name: `${STAMP}-coB` } });

    callA = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:a-own`,
        direction: 'inbound',
        callerNumber: '+79991112222',
        status: 'completed',
        companyId: companyA.id,
      },
    });
    callB = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:b-secret`,
        direction: 'inbound',
        callerNumber: '+79995556666',
        status: 'completed',
        companyId: companyB.id,
      },
    });
    callUnresolved = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:u-shared`,
        direction: 'inbound',
        callerNumber: '+79997778888',
        status: 'completed',
        companyId: null,
      },
    });
  });

  afterAll(async () => {
    await prisma.call.deleteMany({ where: { externalId: { startsWith: STAMP } } });
    await prisma.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } });
  });

  it("manager A's listCalls does not return company B's call in items", async () => {
    const result = await listCalls(prisma, managerSession(companyA.id));
    const ids = result.items.map((c) => c.id);
    expect(ids).toContain(callA.id);
    expect(ids).not.toContain(callB.id);
  });

  it("manager A's listCalls total counts A's scope (own + unresolved) and NOT company B's call", async () => {
    // Fetch every A-scoped row so pagination cannot hide B behind page-2.
    const result = await listCalls(prisma, managerSession(companyA.id), { pageSize: 100 });

    // The `total` field is the load-bearing assertion here: it must equal the
    // DB count of A's scope (own company + shared unresolved) — the exact same
    // OR the service applies — and thus exclude B's bound row.
    const expectedScopedTotal = await prisma.call.count({
      where: { OR: [{ companyId: companyA.id }, { companyId: null }] },
    });
    expect(result.total).toBe(expectedScopedTotal);

    // Sanity: B's row exists and a naive all-count is strictly larger than the
    // scoped total, proving `total` genuinely excludes B rather than the DB
    // just happening to hold only A-scoped rows.
    const naiveAllCount = await prisma.call.count();
    expect(naiveAllCount).toBeGreaterThan(result.total);
    expect(result.total).toBeGreaterThanOrEqual(2); // callA + callUnresolved at minimum

    // And B never surfaces in the returned page.
    const ids = result.items.map((c) => c.id);
    expect(ids).toContain(callA.id);
    expect(ids).toContain(callUnresolved.id);
    expect(ids).not.toContain(callB.id);
  });

  it('filtering by orgId cannot be used to leak company B rows into A scope', async () => {
    const result = await listCalls(prisma, managerSession(companyA.id), { orgId: 'any-org' });
    const ids = result.items.map((c) => c.id);
    expect(ids).not.toContain(callB.id);
  });
});
