import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getFunnelBoard } from '@/lib/services/funnel/board';

/**
 * Coverage top-up for funnel/board.ts @56 — the TRUE side of
 * `estimatedAmount: l.estimatedAmount ? l.estimatedAmount.toFixed(2) : null`.
 *
 * The mirror cov.access-funnel.test.ts covers only the FALSE side (amount-less
 * lead → null). Here a lead in scope carries a non-null Prisma.Decimal amount,
 * so the ternary's truthy branch runs and the card exposes the `.toFixed(2)`
 * string. Mirrors that file's getFunnelBoard setup: a DEDICATED company with NO
 * custom FunnelStage rows (so resolveFunnelStages → DEFAULT_FUNNEL_STAGES and the
 * `new` anchor column exists) + a profile-less manager session (→ where={} so the
 * lead is unconditionally in scope) + a partner + the lead.
 */

let prisma: PrismaClient;
const STAMP = Date.now();

let coId: string;
let mgrId: string;
let partnerId: string;
let orgId: string;
let leadId: string;

// Non-null Decimal chosen so .toFixed(2) is deterministic and asserts the
// two-decimal formatting (14345.6 → "14345.60").
const AMOUNT = new Prisma.Decimal('14345.6');

beforeAll(async () => {
  prisma = new PrismaClient();
  // Dedicated company with NO custom FunnelStage rows → DEFAULT_FUNNEL_STAGES.
  coId = (await prisma.company.create({ data: { name: `cov2Board-${STAMP}` } })).id;
  mgrId = (
    await prisma.user.create({
      data: { email: `cov2BoardM-${STAMP}@t.local`, name: 'Board Mgr', role: 'manager', companyId: coId }
    })
  ).id;
  partnerId = (
    await prisma.partner.create({ data: { name: `cov2Bp-${STAMP}`, slug: `cov2Bp-${STAMP}` } })
  ).id;
  orgId = (
    await prisma.organization.create({ data: { name: `cov2BoardOrg-${STAMP}`, companyId: coId, partnerId } })
  ).id;
  leadId = (
    await prisma.lead.create({
      data: {
        partnerId,
        createdByUserId: mgrId,
        organizationId: orgId, // @57: l.organization?.name present side
        assignedManagerId: mgrId, // @58: l.assignedManager?.name present side
        clientCompanyName: `cov2-amount-${STAMP}`,
        clientContactName: 'K',
        subject: 'S',
        status: 'new',
        estimatedAmount: AMOUNT
      }
    })
  ).id;
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.user.deleteMany({ where: { id: mgrId } });
  await prisma.company.deleteMany({ where: { id: coId } });
  await prisma.$disconnect();
});

describe('funnel/board — getFunnelBoard estimatedAmount truthy side (@56)', () => {
  it('non-null Decimal estimatedAmount → card exposes the .toFixed(2) string', async () => {
    // No accessProfile → leadWhereForLevel not applied → where={} → lead in scope.
    const session = {
      sub: mgrId,
      role: 'manager',
      companyId: coId,
      managedOrgIds: []
    } as unknown as SessionPayload;

    const board = await getFunnelBoard(prisma, session);
    const newCol = board.columns.find((c) => c.stage.statusAnchor === 'new')!;
    const card = newCol.cards.find((c) => c.id === leadId)!;

    expect(card).toBeDefined();
    // The truthy branch ran: string, not null, and formatted to exactly 2 dp.
    expect(card.estimatedAmount).toBe(AMOUNT.toFixed(2));
    expect(card.estimatedAmount).toBe('14345.60');
    // @57/@58: organization + assignedManager present → name (not the ?? null side).
    expect(card.organizationName).toBe(`cov2BoardOrg-${STAMP}`);
    expect(card.assignedManagerName).toBe('Board Mgr');
  });
});
