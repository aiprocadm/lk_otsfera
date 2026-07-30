import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { getOrganizationCard } from '@/lib/services/manager/organizationCard';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * G4.3 — CRM-карточка организации против Postgres. Агрегация заявок/документов/
 * оплат/переписки; IDOR (чужая орг → null); комиссия скрыта в менеджерском контуре;
 * company-scope (teamMode C8).
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string, companyB: string, leaderA: string, plainA: string, mB: string;
let orgA: string, orgB: string, orderA: string, inboundA: string, callA: string;

// companyA — teamMode ON (граница изоляции = компания); companyB — OFF (по умолчанию).
const leaderSession = (): SessionPayload =>
  ({ sub: leaderA, role: 'manager', managerRole: 'leader', companyId: companyA, managedOrgIds: [] } as unknown as SessionPayload);
const plainSession = (): SessionPayload =>
  ({ sub: plainA, role: 'manager', managerRole: null, companyId: companyA, managedOrgIds: [] } as unknown as SessionPayload);
const mBSession = (): SessionPayload =>
  ({ sub: mB, role: 'manager', companyId: companyB, managedOrgIds: [] } as unknown as SessionPayload);

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `g4a-${STAMP}`, managerTeamVisibility: true } })).id;
  companyB = (await prisma.company.create({ data: { name: `g4b-${STAMP}` } })).id;
  leaderA = (await prisma.user.create({ data: { email: `g4la-${STAMP}@t.local`, name: 'LA', role: 'manager', managerRole: 'leader', companyId: companyA } })).id;
  plainA = (await prisma.user.create({ data: { email: `g4pa-${STAMP}@t.local`, name: 'PA', role: 'manager', companyId: companyA } })).id;
  mB = (await prisma.user.create({ data: { email: `g4mb-${STAMP}@t.local`, name: 'MB', role: 'manager', companyId: companyB } })).id;
  orgA = (await prisma.organization.create({ data: { name: `g4orgA-${STAMP}`, companyId: companyA, inn: `77${STAMP}`.slice(0, 12), kpp: '770201001', partnerCommissionRate: new Prisma.Decimal('0.1500') } })).id;
  orgB = (await prisma.organization.create({ data: { name: `g4orgB-${STAMP}`, companyId: companyB } })).id;
  orderA = (await prisma.order.create({ data: { title: `g4ordA-${STAMP}`, companyId: companyA, organizationId: orgA } })).id;
  // Document XOR CHECK: заполняем ЛИБО orderId, ЛИБО companyId (не оба) — документ привязан к заявке.
  await prisma.document.create({ data: { name: `g4doc-${STAMP}`, path: `p/${STAMP}`, mimeType: 'application/pdf', counterpartyType: 'organization', counterpartyId: orgA, orderId: orderA } });
  await prisma.payment.create({ data: { organizationId: orgA, orderId: orderA, amount: new Prisma.Decimal('1000.00'), paidAt: new Date() } });
  await prisma.payment.create({ data: { organizationId: orgA, orderId: orderA, amount: new Prisma.Decimal('200.00'), paidAt: new Date(), isRefund: true } });
  await prisma.comment.create({ data: { body: 'Комментарий по заявке', orderId: orderA, authorId: leaderA } });
  inboundA = (await prisma.inboundMessage.create({
    data: {
      channel: 'telegram',
      externalId: `g4inbound-${STAMP}`,
      senderRef: `g4sender-${STAMP}`,
      senderDisplay: 'Иван Иванов',
      body: 'Здравствуйте, вопрос по заявке',
      resolvedOrgId: orgA,
      companyId: companyA,
      status: 'bound'
    }
  })).id;
  callA = (await prisma.call.create({
    data: {
      provider: 'mango',
      externalId: `g4call-${STAMP}`,
      direction: 'inbound',
      callerNumber: '+79991234567',
      status: 'completed',
      durationSec: 42,
      resolvedOrgId: orgA,
      companyId: companyA,
      recordingPath: `recordings/g4call-${STAMP}.mp3`,
      recordingScanStatus: 'clean'
    }
  })).id;
});

afterAll(async () => {
  await prisma.call.deleteMany({ where: { id: callA } });
  await prisma.inboundMessage.deleteMany({ where: { id: inboundA } });
  await prisma.comment.deleteMany({ where: { orderId: orderA } });
  await prisma.document.deleteMany({ where: { orderId: orderA } });
  await prisma.payment.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await prisma.order.deleteMany({ where: { id: orderA } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [leaderA, plainA, mB] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('getOrganizationCard — агрегация', () => {
  it('лидер: карточка агрегирует заявки/документы/оплаты/переписку + KPI', async () => {
    const card = await getOrganizationCard(prisma, leaderSession(), orgA);
    expect(card).not.toBeNull();
    if (!card) return;
    expect(card.name).toContain('g4orgA');
    expect(card.counts.orders).toBeGreaterThanOrEqual(1);
    expect(card.orders.some((o) => o.id === orderA)).toBe(true);
    expect(card.documents.length).toBe(1);
    expect(card.payments.length).toBe(2);
    expect(card.activity.length).toBe(1);
    // 1000 оплата − 200 возврат = 800.00
    expect(card.kpis.totalPaid).toBe('800.00');
    expect(card.kpis.totalRefunded).toBe('200.00');
  });

  it('лидер: карточка агрегирует обращения (inboundMessages)', async () => {
    const card = await getOrganizationCard(prisma, leaderSession(), orgA);
    expect(card).not.toBeNull();
    if (!card) return;
    expect(card.inboundMessages.some((m) => m.id === inboundA)).toBe(true);
  });

  it('лидер: карточка агрегирует звонки (calls) без утечки recordingPath', async () => {
    const card = await getOrganizationCard(prisma, leaderSession(), orgA);
    expect(card).not.toBeNull();
    if (!card) return;
    const call = card.calls.find((c) => c.id === callA);
    expect(call).toBeDefined();
    expect(call?.hasRecording).toBe(true);
    expect(call?.recordingScanStatus).toBe('clean');
    expect(call).not.toHaveProperty('recordingPath');
  });

  it('лидер видит комиссию (partnerCommissionRate)', async () => {
    const card = await getOrganizationCard(prisma, leaderSession(), orgA);
    expect(card?.commission).not.toBeNull();
    expect(card?.commission?.partnerCommissionRate).toBe('0.1500');
  });

  it('рядовой менеджер: комиссия скрыта (commission=null), но карточка видна', async () => {
    const card = await getOrganizationCard(prisma, plainSession(), orgA);
    expect(card).not.toBeNull();
    expect(card?.commission).toBeNull();
  });
});

describe('getOrganizationCard — изоляция', () => {
  it('IDOR: менеджер компании B не видит орг компании A → null', async () => {
    expect(await getOrganizationCard(prisma, mBSession(), orgA)).toBeNull();
  });

  it('лидер компании A не видит орг компании B → null', async () => {
    expect(await getOrganizationCard(prisma, leaderSession(), orgB)).toBeNull();
  });
});

/**
 * Лидер-инвариант C8 в САМОЙ карточке, а не только в гарде страницы.
 *
 * Дефект, найденный живой проверкой стенда 30.07.2026: PR #273 добавил правило
 * в `canManagerAccessOrg` (гард страницы), но `getOrganizationCard` продолжал
 * фильтровать по закреплению. Гард пускал, карточка отдавала null — страница
 * показывала «не найдено». Автотесты этого не видели: гард и карточку они
 * проверяли по отдельности.
 *
 * Берём companyB — там `managerTeamVisibility` ВЫКЛЮЧЕН, значит доступ может
 * дать только лидер-инвариант, а не company-режим.
 */
describe('карточка организации — руководитель без закрепления (teamMode OFF)', () => {
  it('видит организацию своей компании', async () => {
    const leaderB = {
      sub: mB,
      role: 'manager',
      managerRole: 'leader',
      companyId: companyB,
      managedOrgIds: []
    } as unknown as SessionPayload;

    const card = await getOrganizationCard(prisma, leaderB, orgB);
    expect(card).not.toBeNull();
  });

  it('НЕ видит организацию чужой компании', async () => {
    const leaderB = {
      sub: mB,
      role: 'manager',
      managerRole: 'leader',
      companyId: companyB,
      managedOrgIds: []
    } as unknown as SessionPayload;

    expect(await getOrganizationCard(prisma, leaderB, orgA)).toBeNull();
  });

  it('обычный менеджер без закрепления по-прежнему не видит', async () => {
    expect(await getOrganizationCard(prisma, mBSession(), orgB)).toBeNull();
  });

  it('несуществующая организация — null, а не падение', async () => {
    expect(await getOrganizationCard(prisma, leaderSession(), 'нет-такой-id')).toBeNull();
  });
});
