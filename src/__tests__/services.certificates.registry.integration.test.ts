import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listCertificates } from '@/lib/services/training/certificates';
import { expiringCertificates as orgExpiring } from '@/lib/services/organization/dashboard';
import { expiringCertificates as partnerExpiring } from '@/lib/services/partner/dashboard';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 3 PR-1: интеграционный прогон реестра удостоверений на живом Postgres —
 * статус-фильтры по validUntil, скоупы организации/партнёра/partner-manager,
 * поиск по ФИО, пагинация с total и KPI-счётчики. Фикстуры self-seeded с
 * префиксом cert3-int, чистятся в afterAll.
 */

const prisma = new PrismaClient();
const T = 'cert3-int';

const NOW = new Date();
const DAY = 24 * 3600 * 1000;
const days = (n: number) => new Date(NOW.getTime() + n * DAY);

let dirId = '';
let orgA = ''; // организация партнёра, закреплена за partner-manager
let orgB = ''; // организация партнёра, НЕ закреплена
let orgC = ''; // чужая организация (без партнёра)
let partnerId = '';
let studentExpired = '';

const orgASession = () =>
  ({
    sub: `${T}-org-user`,
    role: 'organization',
    organizationMemberships: [{ organizationId: orgA, roleInOrg: 'admin', isActive: true }]
  }) as never as SessionPayload;

beforeAll(async () => {
  const dir = await prisma.trainingDirection.create({ data: { name: `${T}-Направление`, sortOrder: 920 } });
  dirId = dir.id;
  const partner = await prisma.partner.create({ data: { name: `${T}-Партнёр` } });
  partnerId = partner.id;
  const a = await prisma.organization.create({ data: { name: `${T}-А`, partnerId } });
  orgA = a.id;
  const b = await prisma.organization.create({ data: { name: `${T}-Б`, partnerId } });
  orgB = b.id;
  const c = await prisma.organization.create({ data: { name: `${T}-Чужая` } });
  orgC = c.id;

  const mk = (orgId: string, name: string) =>
    prisma.student.create({ data: { name, email: `${T}-${name}-${orgId}@x.test`, organizationId: orgId } });

  const s1 = await mk(orgA, 'Истёкший Иван');
  studentExpired = s1.id;
  const s2 = await mk(orgA, 'Истекающий Пётр');
  const s3 = await mk(orgA, 'Действующий Фёдор');
  const s4 = await mk(orgA, 'Бессрочный Олег');
  const s5 = await mk(orgB, 'Соседний Николай');
  const s6 = await mk(orgC, 'Чужой Максим');

  const cert = (studentId: string, organizationId: string, number: string, validUntil: Date | null) =>
    prisma.certificate.create({
      data: { studentId, organizationId, directionId: dirId, number: `${T}-${number}`, issuedAt: days(-365), validUntil }
    });

  await cert(s1.id, orgA, '01', days(-5)); // истекло
  await cert(s2.id, orgA, '02', days(10)); // истекает
  await cert(s3.id, orgA, '03', days(120)); // действует
  await cert(s4.id, orgA, '04', null); // бессрочное
  await cert(s5.id, orgB, '05', days(10)); // истекает, но в orgB
  await cert(s6.id, orgC, '06', days(10)); // чужая организация
});

afterAll(async () => {
  await prisma.certificate.deleteMany({ where: { number: { startsWith: T } } });
  await prisma.student.deleteMany({ where: { email: { startsWith: T } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.trainingDirection.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.$disconnect();
});

describe('listCertificates (integration): статусы и скоупы', () => {
  it('организация: видит только свои 4; статус-фильтры делят их корректно', async () => {
    const all = await listCertificates(prisma, orgASession(), { organizationId: orgA });
    if (!all.ok) throw new Error('expected ok');
    expect(all.total).toBe(4);
    expect(all.certificates.map((c) => c.number).sort()).toEqual([`${T}-01`, `${T}-02`, `${T}-03`, `${T}-04`]);

    const expired = await listCertificates(prisma, orgASession(), { organizationId: orgA, status: 'expired' });
    if (!expired.ok) throw new Error('expected ok');
    expect(expired.certificates.map((c) => c.number)).toEqual([`${T}-01`]);

    const expiring = await listCertificates(prisma, orgASession(), { organizationId: orgA, status: 'expiring' });
    if (!expiring.ok) throw new Error('expected ok');
    expect(expiring.certificates.map((c) => c.number)).toEqual([`${T}-02`]);

    const active = await listCertificates(prisma, orgASession(), { organizationId: orgA, status: 'active' });
    if (!active.ok) throw new Error('expected ok');
    // Действующие: за горизонтом + бессрочное.
    expect(active.certificates.map((c) => c.number).sort()).toEqual([`${T}-03`, `${T}-04`]);
  });

  it('организация: чужой organizationId → пустая выдача (пересечение со скоупом)', async () => {
    const res = await listCertificates(prisma, orgASession(), { organizationId: orgC });
    if (!res.ok) throw new Error('expected ok');
    expect(res.total).toBe(0);
  });

  it('партнёр-админ видит организации партнёра (5), чужую — нет; фильтр организации работает', async () => {
    const pa = { sub: `${T}-pa`, role: 'partner', partnerId, partnerRole: 'admin' } as never as SessionPayload;
    const all = await listCertificates(prisma, pa, {});
    if (!all.ok) throw new Error('expected ok');
    expect(all.total).toBe(5);
    expect(all.certificates.some((c) => c.number === `${T}-06`)).toBe(false);

    const onlyB = await listCertificates(prisma, pa, { organizationId: orgB });
    if (!onlyB.ok) throw new Error('expected ok');
    expect(onlyB.certificates.map((c) => c.number)).toEqual([`${T}-05`]);
    expect(onlyB.certificates[0].organization.name).toBe(`${T}-Б`);
  });

  it('partner-manager: скоуп сужен закреплёнными организациями', async () => {
    const pm = {
      sub: `${T}-pm`,
      role: 'partner',
      partnerId,
      partnerRole: 'manager',
      assignedOrgIds: [orgA]
    } as never as SessionPayload;
    const res = await listCertificates(prisma, pm, {});
    if (!res.ok) throw new Error('expected ok');
    expect(res.total).toBe(4);
    expect(res.certificates.some((c) => c.number === `${T}-05`)).toBe(false);
  });

  it('поиск по ФИО и пагинация с total', async () => {
    const found = await listCertificates(prisma, orgASession(), { organizationId: orgA, search: 'истёкший' });
    if (!found.ok) throw new Error('expected ok');
    expect(found.certificates.map((c) => c.student.id)).toEqual([studentExpired]);

    const page = await listCertificates(prisma, orgASession(), { organizationId: orgA, take: 2, skip: 2 });
    if (!page.ok) throw new Error('expected ok');
    expect(page.total).toBe(4);
    expect(page.certificates).toHaveLength(2);
  });
});

describe('KPI-счётчики дашбордов (integration)', () => {
  it('организация: только истекающие (не истёкшие, не за горизонтом, не бессрочные)', async () => {
    expect(await orgExpiring(prisma, orgA)).toBe(1);
  });

  it('партнёр: обе организации; scopeOrgIds сужает', async () => {
    expect(await partnerExpiring(prisma, { partnerId, scopeOrgIds: [] })).toBe(2);
    expect(await partnerExpiring(prisma, { partnerId, scopeOrgIds: [orgB] })).toBe(1);
  });
});
