import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrgOrder, listOrgOrders } from '@/lib/services/organization/orders';
import { attention, kpis } from '@/lib/services/organization/dashboard';
import { orgOrderScope, setOrgMemberScope } from '@/lib/services/organization/memberScope';
import { getOrgFinanceKpis, listOrgPayments } from '@/lib/services/organization/finance';

/**
 * Интеграция `У-236` (живой Postgres): при включённой настройке участник
 * организации видит только «свои» заказы — где он контактное лицо либо подал
 * обращение, из которого вырос заказ. Администратор организации видит все;
 * при выключенной настройке всё как раньше. Чужой заказ по прямой ссылке —
 * `null` (IDOR), а не «нет прав».
 */
let prisma: PrismaClient;
const STAMP = Date.now();
let companyId = '';
let orgId = '';
let adminUser = '';
let memberUser = '';
let otherUser = '';
let orderOwnContact = '';
let orderOwnRequest = '';
let orderForeign = '';

const sessionOf = (sub: string, roleInOrg: 'admin' | 'member'): SessionPayload =>
  ({
    sub,
    role: 'organization',
    organizationMemberships: [{ organizationId: orgId, roleInOrg, isActive: true }],
  }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  const company = await prisma.company.create({ data: { name: `scopeCo-${STAMP}` } });
  companyId = company.id;
  const org = await prisma.organization.create({
    data: { name: `scopeOrg-${STAMP}`, companyId },
  });
  orgId = org.id;

  const users = await Promise.all([
    prisma.user.create({
      data: { email: `scope-adm-${STAMP}@x.local`, name: 'Админ', role: 'organization' },
    }),
    prisma.user.create({
      data: { email: `scope-mem-${STAMP}@x.local`, name: 'Участник', role: 'organization' },
    }),
    prisma.user.create({
      data: { email: `scope-oth-${STAMP}@x.local`, name: 'Коллега', role: 'organization' },
    }),
  ]);
  adminUser = users[0]!.id;
  memberUser = users[1]!.id;
  otherUser = users[2]!.id;

  // Заказ 1 — участник указан контактным лицом.
  const contact = await prisma.contact.create({
    data: { organizationId: orgId, companyId, name: 'Участник', userId: memberUser },
  });
  const o1 = await prisma.order.create({
    data: {
      title: `scopeOwnContact-${STAMP}`,
      organizationId: orgId,
      companyId,
      primaryContactId: contact.id,
      executionStatus: 'in_progress',
      financialStatus: 'billed',
      totalAmount: 1000,
      paidAmount: 0,
    },
  });
  orderOwnContact = o1.id;

  // Заказ 2 — вырос из обращения, поданного участником.
  const request = await prisma.clientRequest.create({
    data: {
      source: 'organization_cabinet',
      companyName: `scopeOrg-${STAMP}`,
      contactName: 'Участник',
      subject: 'Обучение',
      organizationId: orgId,
      submittedByUserId: memberUser,
    },
  });
  const o2 = await prisma.order.create({
    data: {
      title: `scopeOwnRequest-${STAMP}`,
      organizationId: orgId,
      companyId,
      executionStatus: 'in_progress',
      financialStatus: 'billed',
      totalAmount: 2000,
      paidAmount: 0,
    },
  });
  orderOwnRequest = o2.id;
  await prisma.lead.create({
    data: {
      sourceRequestId: request.id,
      createdByUserId: adminUser,
      organizationId: orgId,
      clientCompanyName: `scopeOrg-${STAMP}`,
      clientContactName: 'Участник',
      subject: 'Обучение',
      promotedOrderId: o2.id,
    },
  });

  // Заказ 3 — чужой: контакт другого человека.
  const otherContact = await prisma.contact.create({
    data: { organizationId: orgId, companyId, name: 'Коллега', userId: otherUser },
  });
  const o3 = await prisma.order.create({
    data: {
      title: `scopeForeign-${STAMP}`,
      organizationId: orgId,
      companyId,
      primaryContactId: otherContact.id,
      executionStatus: 'in_progress',
      financialStatus: 'billed',
      totalAmount: 4000,
      paidAmount: 0,
    },
  });
  orderForeign = o3.id;

  // Деньги: платёж по своему заказу, по чужому и платёж без заказа. Последний
  // «своим» быть не может — фильтр по связи обязан его отсечь.
  await prisma.payment.createMany({
    data: [
      { organizationId: orgId, orderId: o1.id, amount: 500, paidAt: new Date() },
      { organizationId: orgId, orderId: o3.id, amount: 1500, paidAt: new Date() },
      { organizationId: orgId, amount: 700, paidAt: new Date() },
    ],
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { organizationId: orgId } });
  await prisma.lead.deleteMany({ where: { organizationId: orgId } });
  await prisma.order.deleteMany({ where: { organizationId: orgId } });
  await prisma.clientRequest.deleteMany({ where: { organizationId: orgId } });
  await prisma.contact.deleteMany({ where: { organizationId: orgId } });
  await prisma.auditLog.deleteMany({ where: { entityId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUser, memberUser, otherUser] } } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('видимость заказов участника организации (У-236)', () => {
  it('настройка выключена — участник видит все заказы организации', async () => {
    const scope = await orgOrderScope(prisma, sessionOf(memberUser, 'member'), orgId);
    expect(scope).toBeNull();
    const { rows, total } = await listOrgOrders(prisma, { organizationId: orgId, scope });
    expect(total).toBe(3);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [orderOwnContact, orderOwnRequest, orderForeign].sort()
    );
  });

  it('включает настройку только администратор организации', async () => {
    expect(await setOrgMemberScope(prisma, sessionOf(memberUser, 'member'), orgId, true)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await setOrgMemberScope(prisma, sessionOf(adminUser, 'admin'), orgId, true)).toEqual({
      ok: true,
    });
    const audit = await prisma.auditLog.findMany({
      where: { action: 'organization_member_scope_changed', entityId: orgId },
      select: { userId: true },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.userId).toBe(adminUser);
  });

  it('участник видит только свои два заказа — списком, карточкой и счётчиками', async () => {
    const scope = await orgOrderScope(prisma, sessionOf(memberUser, 'member'), orgId);
    expect(scope).not.toBeNull();

    const { rows, total } = await listOrgOrders(prisma, { organizationId: orgId, scope });
    expect(total).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual([orderOwnContact, orderOwnRequest].sort());

    const own = await getOrgOrder(prisma, orgId, orderOwnContact, scope);
    expect(own?.ownedByViewer).toBe(true);
    const fromRequest = await getOrgOrder(prisma, orgId, orderOwnRequest, scope);
    expect(fromRequest?.ownedByViewer).toBe(true);
    // Чужой заказ по прямой ссылке — «не найдено», а не «нет прав» (IDOR).
    expect(await getOrgOrder(prisma, orgId, orderForeign, scope)).toBeNull();

    const k = await kpis(prisma, orgId, scope);
    expect(k.activeOrders).toBe(2);
    // 1000 + 2000 выставлено, оплат нет: чужие 4000 в долг не попали.
    expect(k.outstandingAmount).toBe('3000.00');
    const a = await attention(prisma, orgId, scope);
    expect(a.items.every((i) => i.orderId !== orderForeign)).toBe(true);

    // Деньги — та же граница: платёж чужого заказа и платёж без заказа скрыты.
    const pays = await listOrgPayments(prisma, { organizationId: orgId, scope });
    expect(pays.map((p) => p.orderId)).toEqual([orderOwnContact]);
    const fin = await getOrgFinanceKpis(prisma, orgId, scope);
    expect(fin.billed).toBe('3000.00');
  });

  it('администратор организации видит всё, даже когда настройка включена', async () => {
    const scope = await orgOrderScope(prisma, sessionOf(adminUser, 'admin'), orgId);
    expect(scope).toBeNull();
    const { total } = await listOrgOrders(prisma, { organizationId: orgId, scope });
    expect(total).toBe(3);
    const k = await kpis(prisma, orgId, scope);
    expect(k.activeOrders).toBe(3);
    const pays = await listOrgPayments(prisma, { organizationId: orgId, scope });
    expect(pays).toHaveLength(3);
    const fin = await getOrgFinanceKpis(prisma, orgId, scope);
    expect(fin.billed).toBe('7000.00');
  });
});
