import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { pushLeadToOneC } from '@/lib/services/oneCSync/push';
import type { OneCAdapter } from '@/lib/services/oneCSync/adapter';

/**
 * Integration proof for C6 decision #2 — concurrent 1C lead push is idempotent.
 *
 * The unit test covers the branch logic with mocks; this test exercises the
 * REAL Postgres atomicity of the `updateMany({ where: { pushedToOneCAt: null }})`
 * claim: two callers race for the same lead and exactly one reaches the adapter.
 */
const prisma = new PrismaClient();

let partnerId: string;
let authorUserId: string;
let leadId: string;

function countingAdapter(counter: { calls: number }): OneCAdapter {
  return {
    pullOrganizations: vi.fn(),
    pullOrders: vi.fn(),
    pullPayments: vi.fn(),
    pullDocuments: vi.fn(),
    pushLead: vi.fn(async () => {
      counter.calls += 1;
      // Small await to widen the race window between the two callers.
      await new Promise((r) => setTimeout(r, 5));
      return { acceptedAt: new Date().toISOString(), oneCRequestId: `req-${counter.calls}` };
    })
  } as unknown as OneCAdapter;
}

beforeEach(async () => {
  const stamp = Date.now();
  const partner = await prisma.partner.create({
    data: { name: `PushIdemPartner-${stamp}`, slug: `push-idem-${stamp}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;

  const author = await prisma.user.create({
    data: { email: `idem-author-${stamp}@test.local`, name: 'Idem Author', role: 'partner', partnerId }
  });
  authorUserId = author.id;

  const lead = await prisma.lead.create({
    data: {
      partnerId,
      createdByUserId: authorUserId,
      clientCompanyName: 'ООО Гонка',
      clientContactName: 'Пётр Петров',
      subject: 'Параллельный push',
      productType: ['course'],
      estimatedAmount: 12345
      // pushedToOneCAt left null — eligible for push
    }
  });
  leadId = lead.id;
});

afterEach(async () => {
  await prisma.syncLog.deleteMany({ where: { entity: 'lead' } });
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { id: authorUserId } });
  await prisma.partner.delete({ where: { id: partnerId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('pushLeadToOneC — concurrent idempotency (integration)', () => {
  it('two parallel pushes hit the adapter exactly once and push the lead once', async () => {
    const counter = { calls: 0 };
    const adapter = countingAdapter(counter);

    const [a, b] = await Promise.all([
      pushLeadToOneC(prisma, leadId, { adapter }),
      pushLeadToOneC(prisma, leadId, { adapter })
    ]);

    // Exactly one caller reached 1C; the other lost the atomic claim and skipped.
    expect(counter.calls).toBe(1);
    expect([a.ok, b.ok]).toEqual([true, true]);

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { pushedToOneCAt: true, externalIdInOneC: true }
    });
    expect(lead?.pushedToOneCAt).not.toBeNull();
    expect(lead?.externalIdInOneC).toBe('req-1');
  });

  it('a fresh push after success is a no-op skip (no second adapter call)', async () => {
    const counter = { calls: 0 };
    const adapter = countingAdapter(counter);

    const first = await pushLeadToOneC(prisma, leadId, { adapter });
    expect(first.ok).toBe(true);
    expect(counter.calls).toBe(1);

    const second = await pushLeadToOneC(prisma, leadId, { adapter });
    expect(second.ok).toBe(true);
    expect(counter.calls).toBe(1); // adapter not called again — already pushed
  });
});
