import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { createOrganizationByManager } from '@/lib/services/manager/organizationCreate';
import { loadManagedOrgIds } from '@/lib/auth/buildSessionClaims';

/**
 * «Создать организацию» сотрудником (этап 6 ТЗ 13.10.2026, `У-308`, `У-309`).
 *
 * Главный инвариант — новая организация **видна создавшему сразу**: она в его
 * компании и закреплена за ним, поэтому попадает в его список при следующем
 * же запросе (список закреплений читается из базы на каждый запрос, `У-275`).
 * Края: дубль по ИНН в своей компании — «уже есть» с id, в чужой — отказ;
 * без ИНН — дубль по ключу названия; кривой ИНН — отказ; чужие роли — отказ.
 */
let prisma: PrismaClient;
const S = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
// ИНН из штампа: уникален между прогонами, 10 цифр.
const innOf = (n: number) =>
  String((Date.now() % 1e8) * 10 + n)
    .padStart(10, '1')
    .slice(-10);
let companyId: string;
let otherCompanyId: string;
let managerId: string;
let adminId: string;
const created: string[] = [];

const sess = (sub: string, role: string, extra: Record<string, unknown> = {}) =>
  ({ sub, role, companyId, managedOrgIds: [], ...extra }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (await prisma.company.create({ data: { name: `OC-co-${S}` } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: `OC-other-${S}` } })).id;
  managerId = (
    await prisma.user.create({
      data: { email: `oc-m-${S}@t.local`, name: 'Менеджер', role: 'manager', companyId },
    })
  ).id;
  adminId = (
    await prisma.user.create({
      data: { email: `oc-a-${S}@t.local`, name: 'Админ', role: 'admin', companyId },
    })
  ).id;
});

afterAll(async () => {
  const orgs = await prisma.organization.findMany({
    where: { companyId: { in: [companyId, otherCompanyId] } },
    select: { id: true },
  });
  const ids = [...new Set([...created, ...orgs.map((o) => o.id)])];
  await prisma.auditLog.deleteMany({ where: { entity: 'organization', entityId: { in: ids } } });
  await prisma.organizationManager.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: [managerId, adminId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await prisma.$disconnect();
});

describe('createOrganizationByManager (`У-308`)', () => {
  it('менеджер создаёт: организация в его компании, закреплена за ним и сразу в его списке', async () => {
    const inn = innOf(1);
    const res = await createOrganizationByManager(prisma, sess(managerId, 'manager'), {
      name: `  ООО Ромашка ${S}  `,
      inn: ` ${inn} `,
    });
    expect(res).toMatchObject({ ok: true, name: `ООО Ромашка ${S}` });
    if (!res.ok) throw new Error('unreachable');
    created.push(res.organizationId);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: res.organizationId },
      select: { companyId: true, inn: true, nameKey: true },
    });
    expect(org).toMatchObject({ companyId, inn });
    expect(org.nameKey).toBeTruthy();
    const link = await prisma.organizationManager.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: res.organizationId, userId: managerId } },
      select: { isActive: true, assignedBy: true },
    });
    expect(link).toEqual({ isActive: true, assignedBy: managerId });
    // Тот же загрузчик, что у getSession: организация видна без перевхода.
    expect(await loadManagedOrgIds(prisma, managerId, companyId)).toContain(res.organizationId);
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'organization', entityId: res.organizationId },
      select: { action: true, userId: true, meta: true },
    });
    expect(audit).toMatchObject({
      action: 'organization_created_manual',
      userId: managerId,
      meta: { after: { source: 'manager', inn } },
    });
  });

  it('тот же ИНН в своей компании — «уже есть» с её id, вторая не создаётся', async () => {
    const inn = innOf(2);
    const first = await createOrganizationByManager(prisma, sess(managerId, 'manager'), {
      name: `Первая ${S}`,
      inn,
    });
    if (!first.ok) throw new Error('first failed');
    created.push(first.organizationId);
    const again = await createOrganizationByManager(prisma, sess(managerId, 'manager'), {
      name: `Другое название ${S}`,
      inn,
    });
    expect(again).toEqual({ ok: false, error: 'org_exists', organizationId: first.organizationId });
  });

  it('ИНН ведётся другой компанией — отказ, чужую организацию не отдаём', async () => {
    const inn = innOf(3);
    const foreign = await prisma.organization.create({
      data: { name: `Чужая ${S}`, inn, companyId: otherCompanyId },
      select: { id: true },
    });
    created.push(foreign.id);
    const res = await createOrganizationByManager(prisma, sess(managerId, 'manager'), {
      name: `Моя ${S}`,
      inn,
    });
    expect(res).toEqual({ ok: false, error: 'org_in_other_company' });
  });

  it('без ИНН дубль ищется по названию в своей компании', async () => {
    const first = await createOrganizationByManager(prisma, sess(managerId, 'manager'), {
      name: `ООО "Василёк ${S}"`,
    });
    if (!first.ok) throw new Error('first failed');
    created.push(first.organizationId);
    const again = await createOrganizationByManager(prisma, sess(managerId, 'manager'), {
      name: `Василёк ${S}`,
    });
    expect(again).toMatchObject({ ok: false, error: 'org_exists' });
  });

  it('название из одних служебных слов (ключа нет) — создаётся, по ключу не ищем', async () => {
    const a = await createOrganizationByManager(prisma, sess(managerId, 'manager'), {
      name: 'ООО',
    });
    const b = await createOrganizationByManager(prisma, sess(managerId, 'manager'), {
      name: 'ООО',
    });
    for (const r of [a, b]) {
      expect(r.ok).toBe(true);
      if (r.ok) created.push(r.organizationId);
    }
  });

  it('пустое название, длинное название и кривой ИНН — отказ формы', async () => {
    const m = sess(managerId, 'manager');
    expect(await createOrganizationByManager(prisma, m, { name: '   ' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await createOrganizationByManager(prisma, m, { name: 'я'.repeat(301) })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await createOrganizationByManager(prisma, m, { name: 'Ок', inn: '12345' })).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('заказчик, партнёр и сотрудник без компании — отказ', async () => {
    for (const s of [
      sess(managerId, 'organization'),
      sess(managerId, 'partner'),
      sess(managerId, 'manager', { companyId: null }),
    ]) {
      expect(await createOrganizationByManager(prisma, s, { name: `X ${S}` })).toEqual({
        ok: false,
        error: 'forbidden',
      });
    }
  });

  it('администратор создаёт в своей компании без закрепления за собой', async () => {
    const res = await createOrganizationByManager(prisma, sess(adminId, 'admin'), {
      name: `Админская ${S}`,
    });
    if (!res.ok) throw new Error('admin failed');
    created.push(res.organizationId);
    expect(
      await prisma.organizationManager.count({ where: { organizationId: res.organizationId } })
    ).toBe(0);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: res.organizationId },
      select: { companyId: true },
    });
    expect(org.companyId).toBe(companyId);
  });
});
