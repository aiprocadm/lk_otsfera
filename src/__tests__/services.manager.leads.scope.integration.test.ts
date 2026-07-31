import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listManagerLeads, getManagerLead } from '@/lib/services/manager/leads';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { SessionAccessProfile } from '@/lib/auth/accessProfile';

/**
 * G2.1 — leads-охват профиля реально сужает `listManagerLeads` против Postgres.
 * Наслоение: нет профиля → team-wide (legacy). Лиды single-tenant (нет companyId).
 */

let prisma: PrismaClient;
const STAMP = Date.now();

let companyId: string, partnerId: string;
let m1: string, m2: string, orgManaged: string;
let leadOwnM1: string, leadOwnM2: string, leadManagedOrg: string, leadUnassigned: string;
let leadNoPartner: string;

const profile = (leads: SessionAccessProfile['leads']): SessionAccessProfile => ({
  id: 'p',
  name: 'Продажи',
  orders: 'own',
  organizations: 'own',
  threads: 'own',
  documents: 'own',
  finance: 'own',
  leads,
  tasks: 'all',
  capabilities: [],
});

const m1Session = (leads?: SessionAccessProfile['leads']): SessionPayload =>
  ({
    sub: m1,
    role: 'manager',
    companyId,
    managedOrgIds: [orgManaged],
    ...(leads ? { accessProfile: profile(leads) } : {}),
  }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (await prisma.company.create({ data: { name: `g2co-${STAMP}` } })).id;
  partnerId = (
    await prisma.partner.create({ data: { name: `g2p-${STAMP}`, slug: `g2p-${STAMP}` } })
  ).id;
  m1 = (
    await prisma.user.create({
      data: { email: `g2m1-${STAMP}@t.local`, name: 'M1', role: 'manager', companyId },
    })
  ).id;
  m2 = (
    await prisma.user.create({
      data: { email: `g2m2-${STAMP}@t.local`, name: 'M2', role: 'manager', companyId },
    })
  ).id;
  orgManaged = (await prisma.organization.create({ data: { name: `g2org-${STAMP}`, companyId } }))
    .id;
  await prisma.organizationManager.create({
    data: { organizationId: orgManaged, userId: m1, isActive: true },
  });

  const mkLead = async (over: {
    assignedManagerId?: string;
    organizationId?: string;
    name: string;
  }) =>
    (
      await prisma.lead.create({
        data: {
          partnerId,
          createdByUserId: m1,
          clientCompanyName: over.name,
          clientContactName: 'Контакт',
          subject: 'Запрос',
          ...(over.assignedManagerId ? { assignedManagerId: over.assignedManagerId } : {}),
          ...(over.organizationId ? { organizationId: over.organizationId } : {}),
        },
      })
    ).id;

  leadOwnM1 = await mkLead({ assignedManagerId: m1, name: `own-m1-${STAMP}` });
  leadOwnM2 = await mkLead({ assignedManagerId: m2, name: `own-m2-${STAMP}` });
  leadManagedOrg = await mkLead({ organizationId: orgManaged, name: `org-${STAMP}` });
  leadUnassigned = await mkLead({ name: `unassigned-${STAMP}` });

  // Лид, заведённый сотрудником вручную: партнёра у него нет вовсе (ФТ-1.6).
  leadNoPartner = (
    await prisma.lead.create({
      data: {
        createdByUserId: m1,
        assignedManagerId: m1,
        clientCompanyName: `no-partner-${STAMP}`,
        clientContactName: 'Контакт',
        subject: 'Запрос без партнёра',
      },
    })
  ).id;
});

afterAll(async () => {
  const ids = [leadOwnM1, leadOwnM2, leadManagedOrg, leadUnassigned, leadNoPartner];
  await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  await prisma.organizationManager.deleteMany({ where: { organizationId: orgManaged } });
  await prisma.organization.deleteMany({ where: { id: orgManaged } });
  await prisma.user.deleteMany({ where: { id: { in: [m1, m2] } } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

async function idsFor(session?: SessionPayload): Promise<string[]> {
  const { rows } = await listManagerLeads(prisma, { session, take: 100 });
  return rows
    .map((r) => r.id)
    .filter((id) => [leadOwnM1, leadOwnM2, leadManagedOrg, leadUnassigned].includes(id));
}

describe('listManagerLeads — G2 leads-scope', () => {
  it('own: только назначенные на себя', async () => {
    const ids = await idsFor(m1Session('own'));
    expect(ids).toEqual([leadOwnM1]);
  });

  it('assigned: свои назначенные ∪ лиды закреплённой орги', async () => {
    const ids = await idsFor(m1Session('assigned'));
    expect(ids.sort()).toEqual([leadOwnM1, leadManagedOrg].sort());
    expect(ids).not.toContain(leadOwnM2);
    expect(ids).not.toContain(leadUnassigned);
  });

  it('all: вся командная очередь', async () => {
    const ids = await idsFor(m1Session('all'));
    expect(ids.sort()).toEqual([leadOwnM1, leadOwnM2, leadManagedOrg, leadUnassigned].sort());
  });

  it('нет профиля → legacy team-wide (все лиды)', async () => {
    const ids = await idsFor(m1Session());
    expect(ids.sort()).toEqual([leadOwnM1, leadOwnM2, leadManagedOrg, leadUnassigned].sort());
  });

  it('own + status-фильтр композятся (AND, не затирают друг друга)', async () => {
    const { rows } = await listManagerLeads(prisma, {
      session: m1Session('own'),
      status: 'new',
      take: 100,
    });
    const ids = rows.map((r) => r.id).filter((id) => id === leadOwnM1 || id === leadOwnM2);
    expect(ids).toEqual([leadOwnM1]);
  });
});

/**
 * Лид без партнёра — обычный случай: сотрудник заводит лид вручную (ФТ-1.6),
 * партнёрской привязки у такого лида нет. И список, и карточка обязаны отдать
 * пустую подпись партнёра, а не упасть и не показать «undefined».
 */
describe('лид без партнёра', () => {
  it('в списке: partnerName = null', async () => {
    const { rows } = await listManagerLeads(prisma, { session: m1Session('all'), take: 100 });
    const row = rows.find((r) => r.id === leadNoPartner);
    expect(row).toBeDefined();
    expect(row?.partnerName).toBeNull();
  });

  it('в карточке: partnerName = null', async () => {
    const res = await getManagerLead(prisma, m1Session('all'), leadNoPartner);
    expect(res).not.toBeNull();
    expect(res?.partnerName).toBeNull();
  });
});
