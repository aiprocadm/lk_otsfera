import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ensureGeneral, openDm, listConversations, markStaffRead, dmKeyFor } from '@/lib/services/staffChat/conversations';
import { sendStaffMessage, listStaffMessages, toggleReaction } from '@/lib/services/staffChat/messages';

/**
 * M4 close-out regression (Task 8, final) — integration coverage for the
 * staff-chat service layer against the live DB. Mirrors
 * `services.deal-activity.idor.integration.test.ts`: seed real rows with a
 * bare `new PrismaClient()`, assert scope isolation/races against real
 * unique indexes, clean up in afterAll respecting FKs.
 *
 * Covers what mocked-Prisma unit tests structurally cannot:
 *   1. C8 isolation for `general` conversations across companies + admin
 *      Model-A oversight (admin sees every company's general).
 *   2. The `dmKey` unique-index race: two concurrent `openDm` calls for the
 *      same pair collapse to exactly one StaffConversation row (P2002
 *      recovery path actually exercised, not mocked).
 *   3. The partial-unique-index race on `general` conversations: two
 *      concurrent `ensureGeneral` calls for a company collapse to one row.
 *   4. Cross-company DM (staff↔staff, different companies) is rejected.
 *   5. Client roles (partner/organization) get graceful empty results /
 *      forbidden, never real access to the staff-chat domain.
 *   6. Reaction toggle is truly idempotent against the live @@unique index.
 *   7. The "first-unread" notification rule: a DM recipient is notified once
 *      per unread streak, not once per message, and again after catching up.
 */

const prisma = new PrismaClient();
const STAMP = `stChat${Date.now()}`;

let companyA: string, companyB: string, companyRace: string;
let m1: string, m2: string, m9: string, adminId: string;

let generalA = '';
let generalB = '';
let generalRace = '';
let dmConversationId = '';

function managerSession(sub: string, companyId: string) {
  return { sub, role: 'manager', companyId } as never;
}
function adminSession(sub: string) {
  return { sub, role: 'admin', companyId: null } as never;
}

beforeAll(async () => {
  const cA = await prisma.company.create({ data: { name: `${STAMP}-coA` } });
  companyA = cA.id;
  const cB = await prisma.company.create({ data: { name: `${STAMP}-coB` } });
  companyB = cB.id;
  // Dedicated company for the ensureGeneral race test — must have NO general
  // row yet when the race runs, otherwise both concurrent calls would hit
  // the findFirst fast path and never actually exercise the create/P2002 race.
  const cR = await prisma.company.create({ data: { name: `${STAMP}-coRace` } });
  companyRace = cR.id;

  const u1 = await prisma.user.create({
    data: { email: `${STAMP}-m1@x.local`, name: `Manager One ${STAMP}`, role: 'manager', companyId: companyA, passwordHash: 'x' }
  });
  m1 = u1.id;
  const u2 = await prisma.user.create({
    data: { email: `${STAMP}-m2@x.local`, name: `Manager Two ${STAMP}`, role: 'manager', companyId: companyA, passwordHash: 'x' }
  });
  m2 = u2.id;
  const u9 = await prisma.user.create({
    data: { email: `${STAMP}-m9@x.local`, name: `Manager Nine ${STAMP}`, role: 'manager', companyId: companyB, passwordHash: 'x' }
  });
  m9 = u9.id;
  const ua = await prisma.user.create({
    data: { email: `${STAMP}-admin@x.local`, name: `Admin ${STAMP}`, role: 'admin', passwordHash: 'x' }
  });
  adminId = ua.id;
});

afterAll(async () => {
  const convIds = [generalA, generalB, generalRace, dmConversationId].filter((id) => id.length > 0);
  await prisma.staffReaction.deleteMany({ where: { message: { conversationId: { in: convIds } } } });
  await prisma.staffMessageRead.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.staffMessage.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.staffParticipant.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.staffConversation.deleteMany({ where: { id: { in: convIds } } });
  // sendStaffMessage writes an AuditLog row per send (required userId FK) —
  // must be cleared before the authoring users are deleted.
  await prisma.auditLog.deleteMany({ where: { userId: { in: [m1, m2] }, entity: 'staff_conversation' } });
  await prisma.notification.deleteMany({ where: { userId: { in: [m1, m2, m9, adminId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [m1, m2, m9, adminId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB, companyRace] } } });
  await prisma.$disconnect();
});

describe('M4 staff chat — C8 isolation (general conversations)', () => {
  it('a manager sees only their own company general; admin sees every company general', async () => {
    const genA = await ensureGeneral(prisma, companyA);
    const genB = await ensureGeneral(prisma, companyB);
    expect(genA.ok).toBe(true);
    expect(genB.ok).toBe(true);
    if (!genA.ok || !genB.ok) throw new Error('ensureGeneral seed failed');
    generalA = genA.conversationId;
    generalB = genB.conversationId;

    const listM1 = await listConversations(prisma, managerSession(m1, companyA));
    expect(listM1.ok).toBe(true);
    const idsM1 = listM1.rows.map((r) => r.id);
    expect(idsM1).toContain(generalA);
    expect(idsM1).not.toContain(generalB);

    const forbidden = await listStaffMessages(prisma, managerSession(m1, companyA), { conversationId: generalB });
    expect(forbidden).toEqual({ ok: false, error: 'forbidden' });

    const listAdmin = await listConversations(prisma, adminSession(adminId));
    expect(listAdmin.ok).toBe(true);
    const idsAdmin = listAdmin.rows.map((r) => r.id);
    expect(idsAdmin).toContain(generalA);
    expect(idsAdmin).toContain(generalB);
  });
});

describe('M4 staff chat — race safety', () => {
  it('dmKey race: two concurrent openDm calls for the same pair collapse to one row', async () => {
    const [r1, r2] = await Promise.all([
      openDm(prisma, managerSession(m1, companyA), { targetUserId: m2 }),
      openDm(prisma, managerSession(m2, companyA), { targetUserId: m1 })
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) throw new Error('openDm race failed');
    expect(r1.conversationId).toBe(r2.conversationId);
    dmConversationId = r1.conversationId;

    const rows = await prisma.staffConversation.findMany({ where: { dmKey: dmKeyFor(m1, m2) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(dmConversationId);
  });

  it('general race: two concurrent ensureGeneral calls for a fresh company collapse to one row', async () => {
    const [g1, g2] = await Promise.all([ensureGeneral(prisma, companyRace), ensureGeneral(prisma, companyRace)]);
    expect(g1.ok).toBe(true);
    expect(g2.ok).toBe(true);
    if (!g1.ok || !g2.ok) throw new Error('ensureGeneral race failed');
    expect(g1.conversationId).toBe(g2.conversationId);
    generalRace = g1.conversationId;

    const rows = await prisma.staffConversation.findMany({ where: { companyId: companyRace, kind: 'general' } });
    expect(rows).toHaveLength(1);
  });
});

describe('M4 staff chat — cross-company DM', () => {
  it('openDm across companies is forbidden even for two managers', async () => {
    const res = await openDm(prisma, managerSession(m1, companyA), { targetUserId: m9 });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('M4 staff chat — client roles', () => {
  it('partner/organization sessions get graceful empty results, never real access', async () => {
    const partnerSession = { sub: `${STAMP}-p1`, role: 'partner', companyId: companyA } as never;
    const orgSession = { sub: `${STAMP}-o1`, role: 'organization', companyId: companyA } as never;

    expect(await listConversations(prisma, partnerSession)).toEqual({ ok: true, rows: [] });
    expect(await listConversations(prisma, orgSession)).toEqual({ ok: true, rows: [] });

    const sendRes = await sendStaffMessage(prisma, partnerSession, {
      conversationId: generalA,
      body: 'client should never post here'
    });
    expect(sendRes).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('M4 staff chat — reaction toggle', () => {
  it('toggling the same reaction twice is idempotent against the live unique index', async () => {
    const sendRes = await sendStaffMessage(prisma, managerSession(m1, companyA), {
      conversationId: dmConversationId,
      body: 'reaction toggle fixture message'
    });
    expect(sendRes.ok).toBe(true);
    if (!sendRes.ok) throw new Error('seed message failed');
    const messageId = sendRes.messageId;

    const on = await toggleReaction(prisma, managerSession(m2, companyA), { messageId, emoji: '👍' });
    expect(on).toEqual({ ok: true, reacted: true });

    const off = await toggleReaction(prisma, managerSession(m2, companyA), { messageId, emoji: '👍' });
    expect(off).toEqual({ ok: true, reacted: false });

    const rows = await prisma.staffReaction.findMany({ where: { messageId } });
    expect(rows).toHaveLength(0);
  });
});

describe('M4 staff chat — first-unread notification rule', () => {
  it('notifies once per unread streak, then again after the recipient catches up', async () => {
    // Reset baseline: the reaction-toggle scenario above already sent the
    // first-ever message in this DM, which triggered its own first-unread
    // notification for m2. Start this scenario from a clean, known state.
    await prisma.notification.deleteMany({ where: { userId: m2, type: 'staff_dm_message' } });
    const resetRead = await markStaffRead(prisma, managerSession(m2, companyA), { conversationId: dmConversationId });
    expect(resetRead).toEqual({ ok: true });

    const first = await sendStaffMessage(prisma, managerSession(m1, companyA), {
      conversationId: dmConversationId,
      body: 'first-unread message 1'
    });
    expect(first.ok).toBe(true);
    const second = await sendStaffMessage(prisma, managerSession(m1, companyA), {
      conversationId: dmConversationId,
      body: 'first-unread message 2'
    });
    expect(second.ok).toBe(true);

    const afterTwoUnread = await prisma.notification.findMany({ where: { userId: m2, type: 'staff_dm_message' } });
    expect(afterTwoUnread).toHaveLength(1);

    const caughtUp = await markStaffRead(prisma, managerSession(m2, companyA), { conversationId: dmConversationId });
    expect(caughtUp).toEqual({ ok: true });

    const third = await sendStaffMessage(prisma, managerSession(m1, companyA), {
      conversationId: dmConversationId,
      body: 'first-unread message 3'
    });
    expect(third.ok).toBe(true);

    const afterCatchUp = await prisma.notification.findMany({ where: { userId: m2, type: 'staff_dm_message' } });
    expect(afterCatchUp).toHaveLength(2);
  });
});
