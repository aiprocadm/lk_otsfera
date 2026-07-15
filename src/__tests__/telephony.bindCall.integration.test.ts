import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { bindCall } from '@/lib/services/telephony/bindCall';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const STAMP = `m2bc${Date.now()}`;
const session = (companyId: string): SessionPayload => ({ sub: 'mgr1', role: 'manager', companyId, managedOrgIds: [] } as any);

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
  await prisma.contactChannel.deleteMany({ where: { contact: { is: { name: { startsWith: STAMP } } } } });
  await prisma.contact.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.user.deleteMany({ where: { id: 'mgr1' } });
});

describe('bindCall', () => {
  it('binds an unresolved call to an org + contact and captures the number as a channel (learn-on-link)', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-co` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-org`, companyId: co.id } });
    const contact = await prisma.contact.create({ data: { companyId: co.id, organizationId: org.id, name: `${STAMP}-Ivan` } });
    const call = await prisma.call.create({ data: { provider: 'mango', externalId: `${STAMP}:c1`, direction: 'inbound', callerNumber: '8 (999) 000-88-77', status: 'completed' } });

    const r = await bindCall(prisma, session(co.id), { callId: call.id, organizationId: org.id, contactId: contact.id });
    expect(r.ok).toBe(true);
    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.resolvedOrgId).toBe(org.id);
    expect(row?.companyId).toBe(co.id);
    expect(row?.contactId).toBe(contact.id);
    const chan = await prisma.contactChannel.findFirst({ where: { contactId: contact.id, normalizedValue: '+79990008877' } });
    expect(chan).not.toBeNull();
  });

  it('C8: refuses to bind to an org in another company', async () => {
    const coA = await prisma.company.create({ data: { name: `${STAMP}-coA` } });
    const coB = await prisma.company.create({ data: { name: `${STAMP}-coB` } });
    const orgB = await prisma.organization.create({ data: { name: `${STAMP}-orgB`, companyId: coB.id } });
    const call = await prisma.call.create({ data: { provider: 'mango', externalId: `${STAMP}:c2`, direction: 'inbound', callerNumber: '+79990001111', status: 'completed' } });
    const r = await bindCall(prisma, session(coA.id), { callId: call.id, organizationId: orgB.id });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });
});
