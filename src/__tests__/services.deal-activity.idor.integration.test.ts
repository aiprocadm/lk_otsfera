import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { getDealActivity } from '@/lib/services/manager/dealActivity';
import { addDealNote } from '@/lib/services/manager/dealNotes';
import { getOrgOrder } from '@/lib/services/organization/orders';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * M1 close-out regression (спека 2026-07-14, Task 6) — final integration
 * coverage for `getDealActivity`/`addDealNote` against the live DB. Mirrors
 * `security.idor-comments.integration.test.ts`: seed real rows with a bare
 * `new PrismaClient()`, assert scope isolation, clean up in afterAll.
 *
 * Covers:
 *   1. IDOR/C8 — a manager in company A can never read company B's deal
 *      activity (getOrder's canSeeOrder guard, reused by getDealActivity).
 *   2. DealNote client-invisibility — the note reaches the owning manager's
 *      feed, but never the organization-facing order-detail service, plus a
 *      structural guarantee that no organization/partner service file even
 *      references DealNote/dealNote.
 *   3. Dialogue filter — view:'dialogue' drops note/call but keeps inbound
 *      client messages; view:'all' surfaces everything.
 *   4. PII journal — deal_activity_inbound/deal_activity_calls rows are
 *      written for the acting manager when the order has inbound + calls.
 */

const prisma = new PrismaClient();
const STAMP = `dealAct${Date.now()}`;
const NOTE_BODY = `M1 внутренняя заметка ${STAMP} — клиент не должен это видеть`;

let companyA: string, companyB: string, companyC: string;
let orgB: string, orgC: string;
let orderB: string, orderC: string;
let managerA: string, managerC: string;
let threadC: string;
let inboundC: string;
let callC: string;

function managerSession(sub: string, companyId: string): SessionPayload {
  return { sub, role: 'manager', companyId, managedOrgIds: [] } as unknown as SessionPayload;
}

beforeAll(async () => {
  process.env.FEATURE_PII_ACCESS_LOG = '1';

  // --- Company A / B: pure IDOR fixture (test 1) -----------------------
  const cA = await prisma.company.create({ data: { name: `${STAMP}-coA` } });
  companyA = cA.id;
  const cB = await prisma.company.create({ data: { name: `${STAMP}-coB` } });
  companyB = cB.id;

  const oB = await prisma.organization.create({ data: { name: `${STAMP}-orgB`, companyId: companyB } });
  orgB = oB.id;
  const ordB = await prisma.order.create({
    data: { title: `${STAMP}-order-B`, companyId: companyB, organizationId: orgB, totalAmount: 100000 }
  });
  orderB = ordB.id;

  const mgrA = await prisma.user.create({
    data: { email: `${STAMP}-mgrA@x.local`, name: `Manager A ${STAMP}`, role: 'manager', companyId: companyA, passwordHash: 'x' }
  });
  managerA = mgrA.id;

  // --- Company C: owning-manager fixture (tests 2-4) --------------------
  const cC = await prisma.company.create({ data: { name: `${STAMP}-coC` } });
  companyC = cC.id;
  const oC = await prisma.organization.create({ data: { name: `${STAMP}-orgC`, companyId: companyC } });
  orgC = oC.id;

  const mgrC = await prisma.user.create({
    data: { email: `${STAMP}-mgrC@x.local`, name: `Manager C ${STAMP}`, role: 'manager', companyId: companyC, passwordHash: 'x' }
  });
  managerC = mgrC.id;

  const ordC = await prisma.order.create({
    data: {
      title: `${STAMP}-order-C`,
      companyId: companyC,
      organizationId: orgC,
      managerId: managerC,
      totalAmount: 250000
    }
  });
  orderC = ordC.id;

  const thread = await prisma.orderThread.create({ data: { orderId: orderC, side: 'org' } });
  threadC = thread.id;

  const inbound = await prisma.inboundMessage.create({
    data: {
      channel: 'email',
      externalId: `${STAMP}-inbound`,
      senderRef: 'client@x.local',
      senderDisplay: `Клиент ${STAMP}`,
      body: `входящее письмо клиента ${STAMP}`,
      sentAt: new Date(),
      threadId: threadC,
      companyId: companyC
    }
  });
  inboundC = inbound.id;

  const call = await prisma.call.create({
    data: {
      provider: 'mango',
      externalId: `${STAMP}-call`,
      direction: 'inbound',
      callerNumber: '+79990000001',
      status: 'completed',
      startedAt: new Date(),
      threadId: threadC,
      companyId: companyC
    }
  });
  callC = call.id;

  // The note itself — via the real service, as the owning manager.
  const noteRes = await addDealNote(prisma, managerSession(managerC, companyC), { orderId: orderC, body: NOTE_BODY });
  if (!noteRes.ok) throw new Error(`addDealNote seed failed: ${noteRes.error}`);
});

afterAll(async () => {
  process.env.FEATURE_PII_ACCESS_LOG = '0';
  await prisma.piiAccessEvent.deleteMany({ where: { userId: { in: [managerA, managerC] } } });
  await prisma.auditLog.deleteMany({ where: { userId: managerC, entity: 'order', entityId: orderC } });
  await prisma.dealNote.deleteMany({ where: { orderId: orderC } });
  await prisma.inboundMessage.deleteMany({ where: { id: inboundC } });
  await prisma.call.deleteMany({ where: { id: callC } });
  await prisma.orderThread.deleteMany({ where: { orderId: orderC } });
  await prisma.order.deleteMany({ where: { id: { in: [orderB, orderC] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgB, orgC] } } });
  await prisma.user.deleteMany({ where: { id: { in: [managerA, managerC] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB, companyC] } } });
  await prisma.$disconnect();
});

describe('M1 deal activity — IDOR/C8 (getDealActivity company isolation)', () => {
  it('manager in company A gets not_found for an order in company B', async () => {
    const res = await getDealActivity(prisma, managerSession(managerA, companyA), orderB, { view: 'all' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('M1 deal activity — DealNote client-invisibility', () => {
  it('the owning manager sees the note in the activity feed', async () => {
    const res = await getDealActivity(prisma, managerSession(managerC, companyC), orderC, { view: 'all' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const note = res.items.find((i) => i.kind === 'note');
    expect(note).toBeDefined();
    expect(note?.body).toBe(NOTE_BODY);
  });

  it('the note is absent from the organization-facing order-detail service (getOrgOrder)', async () => {
    // `getOrgOrder` is the client (organization) order-detail read for this
    // order's tenant. `OrgOrderDetail` has no notes field at all — this is
    // the runtime proof that the note text does not leak through ANY field
    // (comments/documents/etc.) of the object actually returned to the client.
    const orgView = await getOrgOrder(prisma, orgC, orderC);
    expect(orgView).not.toBeNull();
    expect(JSON.stringify(orgView)).not.toContain(NOTE_BODY);
  });

  it('structural guarantee: no organization/partner service file references DealNote', () => {
    // Belt-and-suspenders alongside the getOrgOrder runtime check above: the
    // partner client order-detail service (getPartnerDealDetail) can only be
    // reached via a Lead-promoted order, which this fixture deliberately is
    // not, so it cannot be exercised the same way as getOrgOrder here. This
    // structural scan closes that gap for both organization/** and
    // partner/**: DealNote/dealNote must never even be *referenced* in the
    // client-facing service layer, regardless of which order is queried.
    const roots = [
      path.join(process.cwd(), 'src', 'lib', 'services', 'organization'),
      path.join(process.cwd(), 'src', 'lib', 'services', 'partner')
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of collectSourceFiles(root)) {
        const src = readFileSync(file, 'utf8');
        if (/dealnote/i.test(src)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('M1 deal activity — dialogue filter', () => {
  it("view:'all' surfaces note/call/message_in; view:'dialogue' drops note/call but keeps message_in", async () => {
    const all = await getDealActivity(prisma, managerSession(managerC, companyC), orderC, { view: 'all' });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    const allKinds = all.items.map((i) => i.kind);
    expect(allKinds).toContain('note');
    expect(allKinds).toContain('call');
    expect(allKinds).toContain('message_in');

    const dialogue = await getDealActivity(prisma, managerSession(managerC, companyC), orderC, { view: 'dialogue' });
    expect(dialogue.ok).toBe(true);
    if (!dialogue.ok) return;
    const dialogueKinds = dialogue.items.map((i) => i.kind);
    expect(dialogueKinds).not.toContain('note');
    expect(dialogueKinds).not.toContain('call');
    expect(dialogueKinds).toContain('message_in'); // dialogue = client-facing comms, inbound included
  });
});

describe('M1 deal activity — PII journal', () => {
  it('writes deal_activity_inbound/deal_activity_calls PiiAccessEvent rows for the acting manager', async () => {
    await prisma.piiAccessEvent.deleteMany({ where: { userId: managerC } });
    const res = await getDealActivity(prisma, managerSession(managerC, companyC), orderC, { view: 'all' });
    expect(res.ok).toBe(true);

    const rows = await prisma.piiAccessEvent.findMany({ where: { userId: managerC } });
    const contexts = rows.map((r) => r.context).sort();
    expect(contexts).toEqual(['deal_activity_calls', 'deal_activity_inbound']);

    const inboundRow = rows.find((r) => r.context === 'deal_activity_inbound');
    const callsRow = rows.find((r) => r.context === 'deal_activity_calls');
    expect(inboundRow?.subjectIds).toContain(inboundC);
    expect(callsRow?.subjectIds).toContain(callC);
  });
});

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectSourceFiles(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}
