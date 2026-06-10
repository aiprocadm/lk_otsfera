import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  listDocuments,
  getDocumentForDownload
} from '@/lib/services/manager/documents';
import type { SessionPayload } from '@/lib/auth/jwt';

let prisma: PrismaClient;

let companyId: string;
let partnerId: string;
let foreignPartnerId: string;
let orgAId: string;
let orgBId: string;
let userAId: string;
let userBId: string;
let userCId: string;

let orderOrgAId: string; // belongs to orgA
let orderOrgBId: string; // belongs to orgB
let orderManagerCId: string; // belongs to orgB, managerId=userC
let orderForeignId: string; // not linked to userA/B/C

let docOrgAContractId: string;
let docOrgAInfectedId: string;
let docOrgBId: string;
let docManagerCId: string;
let docForeignId: string;

function managerSession(userId: string, managedOrgIds: string[]): SessionPayload {
  return { sub: userId, role: 'manager', managedOrgIds };
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();

  const company = await prisma.company.create({ data: { name: `MgrDocC-${stamp}` } });
  companyId = company.id;
  const partner = await prisma.partner.create({
    data: { name: `MgrDocP-${stamp}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const foreignPartner = await prisma.partner.create({
    data: { name: `MgrDocFP-${stamp}`, commissionRate: 0.1 }
  });
  foreignPartnerId = foreignPartner.id;

  const orgA = await prisma.organization.create({
    data: { name: `MgrDocOrgA-${stamp}`, partnerId, companyId }
  });
  orgAId = orgA.id;
  const orgB = await prisma.organization.create({
    data: { name: `MgrDocOrgB-${stamp}`, partnerId, companyId }
  });
  orgBId = orgB.id;

  const userA = await prisma.user.create({
    data: {
      email: `mgr-doc-a-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager A',
      role: 'manager'
    }
  });
  userAId = userA.id;
  const userB = await prisma.user.create({
    data: {
      email: `mgr-doc-b-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager B',
      role: 'manager'
    }
  });
  userBId = userB.id;
  const userC = await prisma.user.create({
    data: {
      email: `mgr-doc-c-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager C',
      role: 'manager'
    }
  });
  userCId = userC.id;

  // userA → orgA; userB → orgB; userC has no org assignment.
  await prisma.organizationManager.create({
    data: { organizationId: orgAId, userId: userAId, isActive: true }
  });
  await prisma.organizationManager.create({
    data: { organizationId: orgBId, userId: userBId, isActive: true }
  });

  const oA = await prisma.order.create({
    data: {
      title: `MgrDocOA-${stamp}`,
      orderNumber: `MD-OA-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgAId,
      executionStatus: 'in_progress'
    }
  });
  orderOrgAId = oA.id;

  const oB = await prisma.order.create({
    data: {
      title: `MgrDocOB-${stamp}`,
      orderNumber: `MD-OB-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgBId,
      executionStatus: 'pending'
    }
  });
  orderOrgBId = oB.id;

  const oMC = await prisma.order.create({
    data: {
      title: `MgrDocMC-${stamp}`,
      orderNumber: `MD-MC-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgBId,
      managerId: userCId,
      executionStatus: 'in_progress'
    }
  });
  orderManagerCId = oMC.id;

  const oF = await prisma.order.create({
    data: {
      title: `MgrDocOF-${stamp}`,
      orderNumber: `MD-OF-${stamp}`,
      companyId,
      partnerId: foreignPartnerId,
      organizationId: orgAId, // sits in orgA but linked to foreign partner
      executionStatus: 'completed'
    }
  });
  orderForeignId = oF.id;

  const dA = await prisma.document.create({
    data: {
      name: 'contract-A.pdf',
      path: 'fake://contract-a',
      mimeType: 'application/pdf',
      type: 'contract',
      orderId: orderOrgAId,
      counterpartyType: 'organization',
      counterpartyId: orgAId
    }
  });
  docOrgAContractId = dA.id;

  const dAInf = await prisma.document.create({
    data: {
      name: 'malware-A.pdf',
      path: 'fake://infected-a',
      mimeType: 'application/pdf',
      type: 'other',
      orderId: orderOrgAId,
      scanStatus: 'infected',
      scanReason: 'EICAR test',
      counterpartyType: 'organization',
      counterpartyId: orgAId
    }
  });
  docOrgAInfectedId = dAInf.id;

  const dB = await prisma.document.create({
    data: {
      name: 'invoice-B.pdf',
      path: 'fake://invoice-b',
      mimeType: 'application/pdf',
      type: 'invoice',
      orderId: orderOrgBId,
      counterpartyType: 'organization',
      counterpartyId: orgBId
    }
  });
  docOrgBId = dB.id;

  const dMC = await prisma.document.create({
    data: {
      name: 'act-MC.pdf',
      path: 'fake://act-mc',
      mimeType: 'application/pdf',
      type: 'act',
      orderId: orderManagerCId,
      counterpartyType: 'organization',
      counterpartyId: orgBId
    }
  });
  docManagerCId = dMC.id;

  const dF = await prisma.document.create({
    data: {
      name: 'foreign.pdf',
      path: 'fake://foreign',
      mimeType: 'application/pdf',
      type: 'other',
      orderId: orderForeignId,
      counterpartyType: 'organization',
      counterpartyId: orgAId
    }
  });
  docForeignId = dF.id;
});

afterAll(async () => {
  const userIds = [userAId, userBId, userCId];
  const orgIds = [orgAId, orgBId];

  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.comment.deleteMany({
    where: {
      OR: [
        { authorId: { in: userIds } },
        { order: { organizationId: { in: orgIds } } }
      ]
    }
  });
  await prisma.document.deleteMany({ where: { order: { organizationId: { in: orgIds } } } });
  await prisma.order.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organizationManager.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.partner.deleteMany({
    where: { id: { in: [partnerId, foreignPartnerId] } }
  });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('services/manager/documents — listDocuments RBAC scope', () => {
  it('per-org scope: userA sees orgA docs, hides infected, excludes orgB docs', async () => {
    const session = managerSession(userAId, [orgAId]);
    const { rows } = await listDocuments(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(docOrgAContractId);
    expect(ids).toContain(docForeignId); // foreign-partner order but still in orgA
    expect(ids).not.toContain(docOrgAInfectedId); // hidden
    expect(ids).not.toContain(docOrgBId);
    expect(ids).not.toContain(docManagerCId);
  });

  it('per-org scope: userB sees orgB docs (both org-only and managerC-managed)', async () => {
    const session = managerSession(userBId, [orgBId]);
    const { rows } = await listDocuments(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(docOrgBId);
    expect(ids).toContain(docManagerCId);
    expect(ids).not.toContain(docOrgAContractId);
  });

  it('per-order scope: userC has no org assignment but still sees own managed order doc', async () => {
    const session = managerSession(userCId, []);
    const { rows } = await listDocuments(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([docManagerCId]);
  });

  it('returns empty for an assignmentless manager with no per-order links', async () => {
    const ghost = await prisma.user.create({
      data: {
        email: `mgr-doc-ghost-${Date.now()}@t.local`,
        passwordHash: 'x',
        role: 'manager',
        name: 'Ghost'
      }
    });
    try {
      const session = managerSession(ghost.id, []);
      const { rows } = await listDocuments(prisma, { session, take: 100 });
      expect(rows).toEqual([]);
    } finally {
      await prisma.user.delete({ where: { id: ghost.id } });
    }
  });
});

describe('services/manager/documents — listDocuments filters', () => {
  it('filters by orderId within scope', async () => {
    const session = managerSession(userBId, [orgBId]);
    const { rows } = await listDocuments(prisma, {
      session,
      orderId: orderManagerCId,
      take: 100
    });
    expect(rows.map((r) => r.id)).toEqual([docManagerCId]);
  });

  it('filters by orderId from a foreign org → empty (scope wins)', async () => {
    const session = managerSession(userAId, [orgAId]);
    const { rows } = await listDocuments(prisma, {
      session,
      orderId: orderOrgBId,
      take: 100
    });
    expect(rows).toEqual([]);
  });

  it('filters by type within scope', async () => {
    const session = managerSession(userBId, [orgBId]);
    const { rows } = await listDocuments(prisma, {
      session,
      type: 'act',
      take: 100
    });
    expect(rows.map((r) => r.id)).toEqual([docManagerCId]);
  });

  it('searches by name (case-insensitive) within scope', async () => {
    const session = managerSession(userBId, [orgBId]);
    const { rows } = await listDocuments(prisma, {
      session,
      q: 'INVOICE',
      take: 100
    });
    expect(rows.map((r) => r.id)).toEqual([docOrgBId]);
  });

  it('paginates with cursor', async () => {
    const session = managerSession(userBId, [orgBId]);
    const first = await listDocuments(prisma, { session, take: 1 });
    expect(first.rows.length).toBe(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listDocuments(prisma, {
      session,
      take: 1,
      cursor: first.nextCursor!
    });
    expect(second.rows.length).toBe(1);
    expect(second.rows[0]!.id).not.toBe(first.rows[0]!.id);
  });

  it('includes order relation on each row', async () => {
    const session = managerSession(userBId, [orgBId]);
    const { rows } = await listDocuments(prisma, { session, take: 100 });
    const mcDoc = rows.find((r) => r.id === docManagerCId);
    expect(mcDoc).toBeDefined();
    expect(mcDoc!.order?.id).toBe(orderManagerCId);
    expect(mcDoc!.order?.organizationId).toBe(orgBId);
    expect(mcDoc!.order?.managerId).toBe(userCId);
  });

  it('rejects take > 100 via zod validation', async () => {
    const session = managerSession(userAId, [orgAId]);
    await expect(
      listDocuments(prisma, { session, take: 9999 })
    ).rejects.toThrow();
  });
});

describe('services/manager/documents — getDocumentForDownload', () => {
  it('returns ok for in-scope clean document', async () => {
    const session = managerSession(userAId, [orgAId]);
    const r = await getDocumentForDownload(prisma, session, docOrgAContractId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path).toBe('fake://contract-a');
      expect(r.mimeType).toBe('application/pdf');
      expect(r.name).toBe('contract-A.pdf');
    }
  });

  it('returns not_found for non-existent id', async () => {
    const session = managerSession(userAId, [orgAId]);
    const r = await getDocumentForDownload(prisma, session, 'cuid-fake');
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns not_found (silent) for out-of-scope document', async () => {
    const session = managerSession(userAId, [orgAId]);
    const r = await getDocumentForDownload(prisma, session, docOrgBId);
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns infected with scanReason for quarantined in-scope document', async () => {
    const session = managerSession(userAId, [orgAId]);
    const r = await getDocumentForDownload(prisma, session, docOrgAInfectedId);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error === 'infected') {
      expect(r.scanReason).toBe('EICAR test');
    } else {
      throw new Error('expected infected discriminator');
    }
  });

  it('per-order path: userC downloads own managed order doc', async () => {
    const session = managerSession(userCId, []);
    const r = await getDocumentForDownload(prisma, session, docManagerCId);
    expect(r.ok).toBe(true);
  });

  it('comments-history path: userA keeps seeing orgB doc via past comment after assignment removed', async () => {
    await prisma.comment.create({
      data: { orderId: orderOrgBId, body: 'historical reply', authorId: userAId }
    });
    await prisma.organizationManager.deleteMany({ where: { userId: userAId } });

    try {
      const session = managerSession(userAId, []); // post-removal session
      const r = await getDocumentForDownload(prisma, session, docOrgBId);
      expect(r.ok).toBe(true);
    } finally {
      await prisma.organizationManager.create({
        data: { organizationId: orgAId, userId: userAId, isActive: true }
      });
    }
  });
});
