import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createContact, captureChannel } from '@/lib/services/manager/contacts';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const STAMP = `m2cs${Date.now()}`;
const session = (companyId: string, managedOrgIds: string[] = []): SessionPayload => ({ sub: 'mgr1', role: 'manager', companyId, managedOrgIds } as any);

// createContact writes an audit row (AuditLog.userId → User FK) and sets
// Contact.createdById (also a real FK) to session.sub — 'mgr1' must exist as
// a real row, same pattern as e.g. e2e.payment-import-idempotency.integration.test.ts
// and import.card51.integration.test.ts ("has a real FK to User → session.sub
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
  // FK-safe order: audit log + contact rows reference the 'mgr1' user before
  // it can be deleted.
  await prisma.auditLog.deleteMany({ where: { userId: 'mgr1' } });
  await prisma.contactChannel.deleteMany({ where: { contact: { is: { name: { startsWith: STAMP } } } } });
  await prisma.contactChannel.deleteMany({ where: { value: { startsWith: STAMP } } });
  await prisma.contact.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.user.deleteMany({ where: { id: 'mgr1' } });
});

describe('contacts service', () => {
  it('createContact: org-less contact scoped to company, normalizes channel values', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-co` } });
    const r = await createContact(prisma, session(co.id), {
      name: `${STAMP}-Иван`, channels: [{ type: 'phone', value: '8 (999) 000-11-22' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await prisma.contact.findUnique({ where: { id: r.contactId }, include: { channels: true } });
    expect(row?.companyId).toBe(co.id);
    expect(row?.organizationId).toBeNull();
    expect(row?.channels[0].normalizedValue).toBe('+79990001122');
    expect(row?.channels[0].isPrimary).toBe(true);
  });

  it('createContact: a leading empty-normalizing channel is dropped and the first SURVIVING channel is primary', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-co3` } });
    const r = await createContact(prisma, session(co.id), {
      name: `${STAMP}-Анна`,
      channels: [{ type: 'email', value: '' }, { type: 'phone', value: '89990001122' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await prisma.contact.findUnique({ where: { id: r.contactId }, include: { channels: true } });
    expect(row?.channels).toHaveLength(1);
    expect(row?.channels[0].type).toBe('phone');
    expect(row?.channels[0].isPrimary).toBe(true);
  });

  it('createContact rejects a session without companyId', async () => {
    const r = await createContact(prisma, session(null as any), { name: `${STAMP}-x`, channels: [] });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('createContact (C8): refuses an organizationId belonging to ANOTHER company — no row persisted', async () => {
    const coA = await prisma.company.create({ data: { name: `${STAMP}-scA` } });
    const coB = await prisma.company.create({ data: { name: `${STAMP}-scB` } });
    const orgB = await prisma.organization.create({ data: { name: `${STAMP}-scOrgB`, companyId: coB.id } });
    // Session in company A, but with orgB in managedOrgIds (cross-company assignment
    // must NOT bypass the company floor — the IDOR the gate closes).
    const r = await createContact(prisma, session(coA.id, [orgB.id]), {
      name: `${STAMP}-scForeign`, organizationId: orgB.id, channels: [],
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    const persisted = await prisma.contact.findFirst({ where: { name: `${STAMP}-scForeign` } });
    expect(persisted).toBeNull();
  });

  it('createContact: refuses an in-company org NOT in managedOrgIds when teamMode is OFF', async () => {
    // Fresh company → managerTeamVisibility defaults to false (teamMode OFF).
    const co = await prisma.company.create({ data: { name: `${STAMP}-scGateCo` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-scGateOrg`, companyId: co.id } });
    const r = await createContact(prisma, session(co.id, []), {
      name: `${STAMP}-scGate`, organizationId: org.id, channels: [],
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    const persisted = await prisma.contact.findFirst({ where: { name: `${STAMP}-scGate` } });
    expect(persisted).toBeNull();
  });

  it('createContact: allows an in-company org that IS in managedOrgIds', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-scOkCo` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-scOkOrg`, companyId: co.id } });
    const r = await createContact(prisma, session(co.id, [org.id]), {
      name: `${STAMP}-scOk`, organizationId: org.id, channels: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await prisma.contact.findUnique({ where: { id: r.contactId } });
    expect(row?.companyId).toBe(co.id);
    expect(row?.organizationId).toBe(org.id);
  });

  it('captureChannel is idempotent and de-dupes on (company,type,normalizedValue)', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-co2` } });
    const c = await prisma.contact.create({ data: { companyId: co.id, name: `${STAMP}-Пётр` } });
    await captureChannel(prisma, { contactId: c.id, companyId: co.id, type: 'telegram', value: 'tg-777' });
    await captureChannel(prisma, { contactId: c.id, companyId: co.id, type: 'telegram', value: 'tg-777' });
    const chans = await prisma.contactChannel.findMany({ where: { contactId: c.id } });
    expect(chans).toHaveLength(1);
  });
});
