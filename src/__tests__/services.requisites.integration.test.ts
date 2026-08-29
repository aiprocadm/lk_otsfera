import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setOrgRequisites, getOrgRequisites } from '@/lib/services/organization/requisites';
import { setPartnerRequisites } from '@/lib/services/partner/requisites';
import {
  setCompanyRequisites,
  listCompaniesRequisites,
} from '@/lib/services/admin/companyRequisites';
import { getOrganizationCard } from '@/lib/services/manager/organizationCard';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 8 PR-1 — реквизиты на живом Postgres: самообслуживание организации
 * (admin пишет, member нет), партнёр, компания; менеджер видит реквизиты в
 * карточке организации; дубль ИНН → понятная валидация.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string;
let orgA: string, orgB: string, partnerA: string;
let manager: string, orgUser: string, partnerUser: string;

/** ИНН второй организации — им же проверяется отказ по дублю. */
const DUP_INN = '7709123453';

const sOrg = (roleInOrg: string): SessionPayload =>
  ({
    sub: orgUser,
    role: 'organization',
    organizationMemberships: [{ organizationId: orgA, roleInOrg, isActive: true }],
  }) as unknown as SessionPayload;
const sPartnerAdmin = (): SessionPayload =>
  ({
    sub: partnerUser,
    role: 'partner',
    partnerId: partnerA,
    partnerRole: 'admin',
  }) as unknown as SessionPayload;
const sAdmin = (): SessionPayload => ({ sub: manager, role: 'admin' }) as unknown as SessionPayload;
const sManager = (): SessionPayload =>
  ({
    sub: manager,
    role: 'manager',
    companyId: companyA,
    managedOrgIds: [orgA],
  }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `s8p1-${STAMP}` } })).id;
  orgA = (
    await prisma.organization.create({ data: { name: `s8p1-orgA-${STAMP}`, companyId: companyA } })
  ).id;
  orgB = (
    await prisma.organization.create({
      // ИНН постоянный, а не из времени: `У-156` ввёл проверку контрольной
      // суммы, и `77<время>` проходил её лишь случайно — тест краснел по
      // календарю, а не по делу.
      data: { name: `s8p1-orgB-${STAMP}`, companyId: companyA, inn: DUP_INN },
    })
  ).id;
  partnerA = (
    await prisma.partner.create({
      data: { name: `s8p1-pt-${STAMP}`, slug: `s8p1-${STAMP}`, commissionRate: 0.1 },
    })
  ).id;
  manager = (
    await prisma.user.create({
      data: { email: `s8p1-m-${STAMP}@t.local`, name: 'М', role: 'manager', companyId: companyA },
    })
  ).id;
  orgUser = (
    await prisma.user.create({
      data: { email: `s8p1-o-${STAMP}@t.local`, name: 'О', role: 'organization' },
    })
  ).id;
  partnerUser = (
    await prisma.user.create({
      data: { email: `s8p1-p-${STAMP}@t.local`, name: 'П', role: 'partner' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [manager, orgUser, partnerUser] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.partner.deleteMany({ where: { id: partnerA } });
  await prisma.user.deleteMany({ where: { id: { in: [manager, orgUser, partnerUser] } } });
  await prisma.company.deleteMany({ where: { id: companyA } });
  await prisma.$disconnect();
});

describe('реквизиты организации', () => {
  it('org-admin сохраняет; member получает forbidden на запись, но читает; менеджер видит в карточке', async () => {
    const res = await setOrgRequisites(prisma, sOrg('admin'), orgA, {
      legalName: 'ООО «Ромашка»',
      inn: '7707083893',
      kpp: '770701001',
      ogrn: '1027700132195',
      legalAddress: 'г. Москва, ул. Тестовая, 1',
      bankName: 'Т-Банк',
      // `У-156` (этап 6): счёт проверяется контрольной суммой по БИК. Прежний
      // «…0001» был выдуман и теперь честно не проходит проверку — заменён на
      // сходящийся с БИК 044525225.
      bankAccount: '40702810400000000005',
      corrAccount: '30101810400000000225',
      bic: '044525225',
      signerName: 'Иванов И.И.',
      signerPosition: 'Генеральный директор',
      signerBasis: 'Устава',
    });
    expect(res).toEqual({ ok: true });

    expect((await setOrgRequisites(prisma, sOrg('member'), orgA, { inn: '7707083893' })).ok).toBe(
      false
    );
    const read = await getOrgRequisites(prisma, sOrg('member'), orgA);
    expect(read.ok && read.requisites.legalName).toBe('ООО «Ромашка»');

    const card = await getOrganizationCard(prisma, sManager(), orgA);
    expect(card!.requisites.bic).toBe('044525225');
    expect(card!.requisites.signerName).toBe('Иванов И.И.');
  });

  it('дубль ИНН другой организации → русская валидация', async () => {
    const dupInn = DUP_INN;
    const res = await setOrgRequisites(prisma, sOrg('admin'), orgA, { inn: dupInn });
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Организация с таким ИНН уже существует'],
    });
  });
});

describe('партнёр и компания', () => {
  it('partner-admin сохраняет реквизиты партнёра', async () => {
    const res = await setPartnerRequisites(prisma, sPartnerAdmin(), {
      kpp: '770801001',
      bic: '044525974',
    });
    expect(res).toEqual({ ok: true });
    const row = await prisma.partner.findUnique({
      where: { id: partnerA },
      select: { kpp: true, bic: true },
    });
    expect(row).toEqual({ kpp: '770801001', bic: '044525974' });
  });

  it('admin сохраняет реквизиты Company (+phone/email) и видит их в списке', async () => {
    const res = await setCompanyRequisites(prisma, sAdmin(), companyA, {
      legalName: 'ООО «Промтехносфера»',
      // `У-156`: ИНН тоже проверяется контрольной суммой — выдуманный
      // «…3456» её не проходит.
      inn: '7708123450',
      phone: '+7 495 000-00-00',
      email: 'docs@pts.ru',
    });
    expect(res).toEqual({ ok: true });
    const list = await listCompaniesRequisites(prisma, sAdmin());
    const row = list.ok ? list.companies.find((c) => c.id === companyA) : null;
    expect(row).toMatchObject({ legalName: 'ООО «Промтехносфера»', email: 'docs@pts.ru' });
  });
});
