import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { bindCall } from '@/lib/services/telephony/bindCall';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const STAMP = `m2bc${Date.now()}`;
const session = (companyId: string, managedOrgIds: string[] = []): SessionPayload =>
  ({ sub: 'mgr1', role: 'manager', companyId, managedOrgIds }) as any;

// bindCall writes an audit row (AuditLog.userId → User FK) to session.sub —
// 'mgr1' must exist as a real row, same pattern as
// contacts.service.integration.test.ts ("has a real FK to User → session.sub
// must be a real user id"). upsert keeps this safe to re-run if a prior crash
// left the row behind.
beforeAll(async () => {
  await prisma.user.upsert({
    where: { id: 'mgr1' },
    create: { id: 'mgr1', email: `${STAMP}-mgr1@t.test`, name: `${STAMP}-mgr1`, role: 'manager' },
    update: {},
  });
});

afterAll(async () => {
  // FK-safe order: audit log rows reference the 'mgr1' user before it can be deleted.
  await prisma.auditLog.deleteMany({ where: { userId: 'mgr1' } });
  await prisma.call.deleteMany({ where: { externalId: { startsWith: STAMP } } });
  // Order.title-scoped delete before organization/company teardown; OrderThread
  // cascades from Order (onDelete: Cascade).
  await prisma.order.deleteMany({ where: { title: { startsWith: STAMP } } });
  await prisma.contactChannel.deleteMany({
    where: { contact: { is: { name: { startsWith: STAMP } } } },
  });
  await prisma.contact.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.user.deleteMany({ where: { id: 'mgr1' } });
});

describe('bindCall', () => {
  it('binds an unresolved call to an org + contact and captures the number as a channel (learn-on-link)', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-co` } });
    const org = await prisma.organization.create({
      data: { name: `${STAMP}-org`, companyId: co.id },
    });
    const contact = await prisma.contact.create({
      data: { companyId: co.id, organizationId: org.id, name: `${STAMP}-Ivan` },
    });
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:c1`,
        direction: 'inbound',
        callerNumber: '8 (999) 000-88-77',
        status: 'completed',
      },
    });

    const r = await bindCall(prisma, session(co.id, [org.id]), {
      callId: call.id,
      organizationId: org.id,
      contactId: contact.id,
    });
    expect(r.ok).toBe(true);
    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.resolvedOrgId).toBe(org.id);
    expect(row?.companyId).toBe(co.id);
    expect(row?.contactId).toBe(contact.id);
    const chan = await prisma.contactChannel.findFirst({
      where: { contactId: contact.id, normalizedValue: '+79990008877' },
    });
    expect(chan).not.toBeNull();
  });

  it('C8: refuses to bind to an org in another company', async () => {
    const coA = await prisma.company.create({ data: { name: `${STAMP}-coA` } });
    const coB = await prisma.company.create({ data: { name: `${STAMP}-coB` } });
    const orgB = await prisma.organization.create({
      data: { name: `${STAMP}-orgB`, companyId: coB.id },
    });
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:c2`,
        direction: 'inbound',
        callerNumber: '+79990001111',
        status: 'completed',
      },
    });
    const r = await bindCall(prisma, session(coA.id), { callId: call.id, organizationId: orgB.id });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('bind-authority: refuses when teamMode is OFF and the target org is NOT in the manager managedOrgIds (even same company)', async () => {
    // Fresh Company → managerTeamVisibility defaults to false (teamMode OFF).
    // Same company isolates the isOrgInScope gate from the C8 company boundary:
    // visibility is company-wide, but bind-authority requires assignment.
    const co = await prisma.company.create({ data: { name: `${STAMP}-coGate` } });
    const org = await prisma.organization.create({
      data: { name: `${STAMP}-orgGate`, companyId: co.id },
    });
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:c3`,
        direction: 'inbound',
        callerNumber: '+79990002222',
        status: 'completed',
      },
    });
    // managedOrgIds is empty → manager is in the company but not assigned to org.
    const r = await bindCall(prisma, session(co.id, []), {
      callId: call.id,
      organizationId: org.id,
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.resolvedOrgId).toBeNull();
  });

  it('returns not_found for a callId that does not exist', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-coNfCall` } });
    const org = await prisma.organization.create({
      data: { name: `${STAMP}-orgNfCall`, companyId: co.id },
    });
    const r = await bindCall(prisma, session(co.id, [org.id]), {
      callId: `${STAMP}-missing-call`,
      organizationId: org.id,
    });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns not_found for an organizationId that does not exist', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-coNfOrg` } });
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:c4`,
        direction: 'inbound',
        callerNumber: '+79990004444',
        status: 'completed',
      },
    });
    const r = await bindCall(prisma, session(co.id), {
      callId: call.id,
      organizationId: `${STAMP}-missing-org`,
    });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('refuses to bind a contact that already belongs to a different organization', async () => {
    // contact.organizationId set AND different from the target org (as opposed to the
    // company-mismatch case above): a different bind-authority gate (lines 64-66).
    const co = await prisma.company.create({ data: { name: `${STAMP}-coCX` } });
    const orgA = await prisma.organization.create({
      data: { name: `${STAMP}-orgCXA`, companyId: co.id },
    });
    const orgB = await prisma.organization.create({
      data: { name: `${STAMP}-orgCXB`, companyId: co.id },
    });
    const contact = await prisma.contact.create({
      data: { companyId: co.id, organizationId: orgB.id, name: `${STAMP}-Cross` },
    });
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:c5`,
        direction: 'inbound',
        callerNumber: '+79990005555',
        status: 'completed',
      },
    });
    const r = await bindCall(prisma, session(co.id, [orgA.id, orgB.id]), {
      callId: call.id,
      organizationId: orgA.id,
      contactId: contact.id,
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.resolvedOrgId).toBeNull();
  });

  it('resolves an in-scope order to its org-side thread (best-effort thread resolution)', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-coOrd` } });
    const org = await prisma.organization.create({
      data: { name: `${STAMP}-orgOrd`, companyId: co.id },
    });
    const order = await prisma.order.create({
      data: { title: `${STAMP}-order1`, companyId: co.id, organizationId: org.id },
    });
    const thread = await prisma.orderThread.create({ data: { orderId: order.id, side: 'org' } });
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:c6`,
        direction: 'inbound',
        callerNumber: '+79990006666',
        status: 'completed',
      },
    });

    const r = await bindCall(prisma, session(co.id, [org.id]), {
      callId: call.id,
      organizationId: org.id,
      orderId: order.id,
    });
    expect(r.ok).toBe(true);
    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.threadId).toBe(thread.id);
  });

  it('order given but it belongs to a different org than the target → threadId stays null (bind still succeeds)', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-coOrdX` } });
    const orgTarget = await prisma.organization.create({
      data: { name: `${STAMP}-orgOrdXTarget`, companyId: co.id },
    });
    const orgOther = await prisma.organization.create({
      data: { name: `${STAMP}-orgOrdXOther`, companyId: co.id },
    });
    const order = await prisma.order.create({
      data: { title: `${STAMP}-order2`, companyId: co.id, organizationId: orgOther.id },
    });
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:c7`,
        direction: 'inbound',
        callerNumber: '+79990007766',
        status: 'completed',
      },
    });

    const r = await bindCall(prisma, session(co.id, [orgTarget.id, orgOther.id]), {
      callId: call.id,
      organizationId: orgTarget.id,
      orderId: order.id,
    });
    expect(r.ok).toBe(true);
    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.threadId).toBeNull();
    expect(row?.resolvedOrgId).toBe(orgTarget.id);
  });

  it('refuses to bind a contact belonging to a different company', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-coCC` } });
    const coForeign = await prisma.company.create({ data: { name: `${STAMP}-coCCForeign` } });
    const org = await prisma.organization.create({
      data: { name: `${STAMP}-orgCC`, companyId: co.id },
    });
    const contact = await prisma.contact.create({
      data: { companyId: coForeign.id, name: `${STAMP}-ForeignContact` },
    });
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:c9`,
        direction: 'inbound',
        callerNumber: '+79990009900',
        status: 'completed',
      },
    });
    const r = await bindCall(prisma, session(co.id, [org.id]), {
      callId: call.id,
      organizationId: org.id,
      contactId: contact.id,
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.resolvedOrgId).toBeNull();
  });

  it('teamMode ON: order.companyId matches session.companyId → in scope, but no OrderThread row exists → threadId stays null', async () => {
    const co = await prisma.company.create({
      data: { name: `${STAMP}-coTm`, managerTeamVisibility: true },
    });
    const org = await prisma.organization.create({
      data: { name: `${STAMP}-orgTm`, companyId: co.id },
    });
    const order = await prisma.order.create({
      data: { title: `${STAMP}-order3`, companyId: co.id, organizationId: org.id },
    });
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:c10`,
        direction: 'inbound',
        callerNumber: '+79990001010',
        status: 'completed',
      },
    });

    // No managedOrgIds needed: teamMode ON grants bind-authority company-wide.
    const r = await bindCall(prisma, session(co.id), {
      callId: call.id,
      organizationId: org.id,
      orderId: order.id,
    });
    expect(r.ok).toBe(true);
    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.resolvedOrgId).toBe(org.id); // orderInScope was true (company matched)…
    expect(row?.threadId).toBeNull(); // …but no OrderThread(side:'org') row exists yet.
  });

  it('non-existent orderId → threadId stays null (bind still succeeds, best-effort)', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-coOrdNf` } });
    const org = await prisma.organization.create({
      data: { name: `${STAMP}-orgOrdNf`, companyId: co.id },
    });
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:c8`,
        direction: 'inbound',
        callerNumber: '+79990008866',
        status: 'completed',
      },
    });

    const r = await bindCall(prisma, session(co.id, [org.id]), {
      callId: call.id,
      organizationId: org.id,
      orderId: `${STAMP}-missing-order`,
    });
    expect(r.ok).toBe(true);
    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.threadId).toBeNull();
  });
});
