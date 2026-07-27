/**
 * Этап 10 PR-2 — негативные тесты видимости по матрице §7 ТЗ.
 *
 * На каждую строку «Партнёр: нет / Организация: нет» — проверка «роль X
 * запрашивает Y → forbidden / пусто / поля нет», против РЕАЛЬНОЙ БД и реальных
 * сервисов (не моков): именно так §7 требует доказывать изоляцию.
 *
 * Дополняет:
 *  - `security.client-visibility.guardrail.test.ts` (статика: домен лидов не
 *    вернулся, запрещённые поля не просочились в исходники);
 *  - `c3.idor-cross-access` / `f.list-cross-tenant` (cross-tenant по заказам,
 *    документам, платежам, спискам менеджера).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { getDealBoard } from '@/lib/services/deals/board';
import { listDealNotes, addNoteToDeal } from '@/lib/services/deals/notes';
import { listIntake } from '@/lib/services/intake/list';
import { listClientRequests } from '@/lib/services/clientRequests/list';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const RUN = `vis-${process.pid}`;

let companyId: string;
let partnerA: string, partnerB: string;
let orgA: string, orgB: string;
let staffId: string, partnerUserA: string, orgUserA: string;
let dealId: string;
let requestA: string, requestB: string;
let leadId: string;

const staffSession = (): SessionPayload =>
  ({ sub: staffId, role: 'manager', companyId, managedOrgIds: [orgA, orgB] }) as unknown as SessionPayload;

const partnerSession = (partnerId: string, sub: string): SessionPayload =>
  ({ sub, role: 'partner', partnerId, companyId: null }) as unknown as SessionPayload;

const orgSession = (organizationId: string, sub: string): SessionPayload =>
  ({
    sub,
    role: 'organization',
    companyId: null,
    organizationMemberships: [{ organizationId, isActive: true, roleInOrg: 'admin' }]
  }) as unknown as SessionPayload;

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `${RUN}-co` } });
  companyId = company.id;

  const pA = await prisma.partner.create({
    data: { name: `${RUN}-pA`, commissionRate: new Prisma.Decimal('0.1') }
  });
  const pB = await prisma.partner.create({
    data: { name: `${RUN}-pB`, commissionRate: new Prisma.Decimal('0.1') }
  });
  partnerA = pA.id;
  partnerB = pB.id;

  const oA = await prisma.organization.create({
    data: { name: `${RUN}-orgA`, companyId, partnerId: partnerA }
  });
  const oB = await prisma.organization.create({
    data: { name: `${RUN}-orgB`, companyId, partnerId: partnerB }
  });
  orgA = oA.id;
  orgB = oB.id;

  const staff = await prisma.user.create({
    data: { email: `${RUN}-staff@t.local`, name: 'Staff', role: 'manager', passwordHash: 'x', companyId }
  });
  staffId = staff.id;
  const pu = await prisma.user.create({
    data: { email: `${RUN}-pa@t.local`, name: 'PartnerA', role: 'partner', passwordHash: 'x', partnerId: partnerA }
  });
  partnerUserA = pu.id;
  const ou = await prisma.user.create({
    data: { email: `${RUN}-oa@t.local`, name: 'OrgA', role: 'organization', passwordHash: 'x' }
  });
  orgUserA = ou.id;
  await prisma.organizationUser.create({
    data: { organizationId: orgA, userId: orgUserA, roleInOrg: 'admin', isActive: true }
  });

  // Внутренний контур: сделка + внутренняя заметка.
  const deal = await prisma.deal.create({
    data: {
      title: `${RUN}-deal`,
      companyId,
      organizationId: orgA,
      managerId: staffId,
      amount: new Prisma.Decimal('1000.00')
    }
  });
  dealId = deal.id;
  await prisma.dealNote.create({
    data: { dealId, authorId: staffId, body: `${RUN} внутренняя заметка — клиенту не видна` }
  });

  // Обращение партнёра A, из которого сотрудник сделал внутренний лид.
  const rA = await prisma.clientRequest.create({
    data: {
      source: 'partner_cabinet',
      companyName: `${RUN}-A`,
      contactName: 'K',
      subject: `${RUN}-reqA`,
      submittedByUserId: partnerUserA,
      partnerId: partnerA,
      organizationId: orgA,
      status: 'converted'
    }
  });
  requestA = rA.id;

  // Связь «заявка → лид» живёт на стороне лида (Lead.sourceRequestId).
  const lead = await prisma.lead.create({
    data: {
      partnerId: partnerA,
      createdByUserId: staffId,
      organizationId: orgA,
      clientCompanyName: `${RUN}-client`,
      clientContactName: 'Контакт',
      subject: `${RUN}-lead`,
      assignedManagerId: staffId,
      sourceRequestId: requestA
    }
  });
  leadId = lead.id;

  const rB = await prisma.clientRequest.create({
    data: {
      source: 'partner_cabinet',
      companyName: `${RUN}-B`,
      contactName: 'K',
      subject: `${RUN}-reqB`,
      submittedByUserId: staffId,
      partnerId: partnerB,
      organizationId: orgB,
      status: 'submitted'
    }
  });
  requestB = rB.id;
});

afterAll(async () => {
  await prisma.piiAccessEvent.deleteMany({ where: { userId: { in: [staffId, partnerUserA, orgUserA] } } });
  await prisma.clientRequest.deleteMany({ where: { id: { in: [requestA, requestB] } } });
  await prisma.dealNote.deleteMany({ where: { dealId } });
  await prisma.deal.deleteMany({ where: { id: dealId } });
  await prisma.lead.deleteMany({ where: { id: leadId } });
  await prisma.organizationUser.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [staffId, partnerUserA, orgUserA] } } });
  await prisma.user.deleteMany({ where: { id: { in: [staffId, partnerUserA, orgUserA] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.partner.deleteMany({ where: { id: { in: [partnerA, partnerB] } } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('§7 «Сделка целиком» — клиенту нет', () => {
  it('доска сделок пуста для партнёра и организации (не раскрывается даже словарь стадий)', async () => {
    const forPartner = await getDealBoard(prisma, partnerSession(partnerA, partnerUserA));
    expect(forPartner.columns).toEqual([]);
    expect(forPartner.stages).toEqual([]);

    const forOrg = await getDealBoard(prisma, orgSession(orgA, orgUserA));
    expect(forOrg.columns).toEqual([]);
    expect(forOrg.stages).toEqual([]);
  });

  it('staff свою сделку видит — позитивный контроль, что фикстура настоящая', async () => {
    const board = await getDealBoard(prisma, staffSession());
    const ids = board.columns.flatMap((c) => c.cards.map((d) => d.id));
    expect(ids).toContain(dealId);
  });
});

describe('§7 «DealNote / внутренние заметки» — клиенту нет', () => {
  it('чтение заметок сделки клиентом → forbidden', async () => {
    const asPartner = await listDealNotes(prisma, partnerSession(partnerA, partnerUserA), { dealId });
    expect(asPartner).toEqual({ ok: false, error: 'forbidden' });

    const asOrg = await listDealNotes(prisma, orgSession(orgA, orgUserA), { dealId });
    expect(asOrg).toEqual({ ok: false, error: 'forbidden' });
  });

  it('запись заметки клиентом → forbidden, в БД ничего не добавилось', async () => {
    const before = await prisma.dealNote.count({ where: { dealId } });
    const res = await addNoteToDeal(prisma, orgSession(orgA, orgUserA), {
      dealId,
      body: 'попытка клиента'
    });
    expect(res.ok).toBe(false);
    expect(await prisma.dealNote.count({ where: { dealId } })).toBe(before);
  });

  it('staff свои заметки читает — позитивный контроль', async () => {
    const res = await listDealNotes(prisma, staffSession(), { dealId });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows.length).toBeGreaterThan(0);
  });
});

describe('§7 «Входящие в работу» (Intake) — клиенту нет', () => {
  it('листинг Intake клиентом → forbidden', async () => {
    expect(await listIntake(prisma, partnerSession(partnerA, partnerUserA))).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(await listIntake(prisma, orgSession(orgA, orgUserA))).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });
});

describe('§7 «Связь заявки с лидом/сделкой» — клиенту нет', () => {
  it('DTO обращения не содержит связей с внутренним контуром — ни клиенту, ни staff', async () => {
    const client = await listClientRequests(prisma, partnerSession(partnerA, partnerUserA), {});
    const own = client.rows.find((r) => r.id === requestA);
    expect(own, 'партнёр видит своё обращение').toBeDefined();

    for (const row of client.rows) {
      const keys = Object.keys(row as Record<string, unknown>);
      expect(keys).not.toContain('convertedLeadId');
      expect(keys).not.toContain('leadId');
      expect(keys).not.toContain('dealId');
    }

    // DTO общий: и в staff-выдаче связи нет (иначе поле вернётся «через заднюю дверь»).
    const staff = await listClientRequests(prisma, staffSession(), {});
    const staffRow = staff.rows.find((r) => r.id === requestA);
    expect(staffRow as Record<string, unknown>).not.toHaveProperty('convertedLeadId');
  });

  it('клиент видит статус своей заявки — позитивный контроль', async () => {
    const client = await listClientRequests(prisma, partnerSession(partnerA, partnerUserA), {});
    const own = client.rows.find((r) => r.id === requestA);
    expect(own?.status).toBe('converted');
  });
});

describe('§7 «Данные других партнёров/организаций» — клиенту нет', () => {
  it('партнёр A не видит обращение партнёра B', async () => {
    const res = await listClientRequests(prisma, partnerSession(partnerA, partnerUserA), {});
    const ids = res.rows.map((r) => r.id);
    expect(ids).toContain(requestA);
    expect(ids).not.toContain(requestB);
  });

  it('организация A не видит обращение организации B', async () => {
    const res = await listClientRequests(prisma, orgSession(orgA, orgUserA), {});
    expect(res.rows.map((r) => r.id)).not.toContain(requestB);
  });
});
