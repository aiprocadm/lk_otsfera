import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { submitClientRequest } from '@/lib/services/clientRequests/submit';
import { takeInTriage, convertToLead, rejectClientRequest } from '@/lib/services/clientRequests/triage';
import { listClientRequests, getClientRequest } from '@/lib/services/clientRequests/list';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 5 PR-1: интеграционный прогон заявок клиентов на живом Postgres
 * (эталоны — services.enrollments.pr2.integration.test.ts,
 * services.stage4.invite.integration.test.ts). Покрывается:
 *  - полный путь партнёрской заявки: submit → takeInTriage менеджером общей
 *    очереди (companyId=null) → convertToLead → повторный convert = 409-код;
 *  - организация: submit от org-роли, скоуп менеджеров по companyId, reject;
 *  - миграция Lead: default source=partner_legacy, partnerId nullable;
 *  - уведомления client_request_status_changed подателю (глобальный
 *    prisma-синглтон notify пишет в ту же тестовую БД);
 *  - recordPiiAccess (флаг включён явно) пишет события и не роняет выдачу.
 *
 * Фикстуры self-seeded с префиксом cr5-int, id/email уникальны на прогон
 * (RUN-суффикс); полный cleanup в beforeAll (хвосты упавших прогонов) и afterAll.
 * Запуск: npx vitest run --mode=integration <файл> (НЕ npm run gate).
 */

// Журнал ПДн включаем по-настоящему (setup-файл ставит '0' по умолчанию):
// проверяем, что recordPiiAccess пишет события и не ломает листинг.
process.env.FEATURE_PII_ACCESS_LOG = '1';

const prisma = new PrismaClient();
const T = 'cr5-int';
const RUN = Date.now().toString(36);

const PARTNER_USER = `${T}-partner-${RUN}`;
const ORG_USER = `${T}-orguser-${RUN}`;
const MGR_GENERAL = `${T}-mgr-general-${RUN}`;
const MGR_A = `${T}-mgr-a-${RUN}`;
const MGR_B = `${T}-mgr-b-${RUN}`;

let partnerId = '';
let companyAId = '';
let companyBId = '';
let org1Id = '';

let partnerSession: SessionPayload;
let orgSession: SessionPayload;
let mgrGeneralSession: SessionPayload;
let mgrASession: SessionPayload;
let mgrBSession: SessionPayload;

let partnerRequestId = '';
let orgRequestId = '';
let convertedLeadId = '';

async function cleanup(): Promise<void> {
  const byUser = { user: { email: { startsWith: T } } };
  await prisma.piiAccessEvent.deleteMany({ where: byUser });
  await prisma.notification.deleteMany({ where: byUser });
  await prisma.auditLog.deleteMany({ where: byUser });
  await prisma.clientRequestAttachment.deleteMany({ where: { request: { companyName: { startsWith: T } } } });
  await prisma.lead.deleteMany({ where: { clientCompanyName: { startsWith: T } } });
  await prisma.clientRequest.deleteMany({ where: { companyName: { startsWith: T } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: T } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: T } } });
}

beforeAll(async () => {
  await cleanup(); // хвосты упавших прогонов не должны мешать текущему

  const partner = await prisma.partner.create({ data: { name: `${T}-Партнёр-${RUN}` } });
  partnerId = partner.id;
  const companyA = await prisma.company.create({ data: { name: `${T}-КомпанияА-${RUN}` } });
  companyAId = companyA.id;
  const companyB = await prisma.company.create({ data: { name: `${T}-КомпанияБ-${RUN}` } });
  companyBId = companyB.id;
  const org1 = await prisma.organization.create({
    data: { name: `${T}-Организация-${RUN}`, companyId: companyAId }
  });
  org1Id = org1.id;

  await prisma.user.create({
    data: { id: PARTNER_USER, email: `${PARTNER_USER}@cr5.test`, name: 'CR5 Партнёрец', role: 'partner', partnerId }
  });
  await prisma.user.create({
    data: { id: ORG_USER, email: `${ORG_USER}@cr5.test`, name: 'CR5 Организация', role: 'organization', organizationId: org1Id }
  });
  await prisma.user.create({
    data: { id: MGR_GENERAL, email: `${MGR_GENERAL}@cr5.test`, name: 'CR5 Менеджер Общий', role: 'manager' }
  });
  await prisma.user.create({
    data: { id: MGR_A, email: `${MGR_A}@cr5.test`, name: 'CR5 Менеджер А', role: 'manager', companyId: companyAId }
  });
  await prisma.user.create({
    data: { id: MGR_B, email: `${MGR_B}@cr5.test`, name: 'CR5 Менеджер Б', role: 'manager', companyId: companyBId }
  });

  partnerSession = { sub: PARTNER_USER, role: 'partner', partnerId } as SessionPayload;
  orgSession = {
    sub: ORG_USER,
    role: 'organization',
    organizationMemberships: [{ organizationId: org1Id, roleInOrg: 'admin', isActive: true }]
  } as SessionPayload;
  mgrGeneralSession = { sub: MGR_GENERAL, role: 'manager', companyId: null } as SessionPayload;
  mgrASession = { sub: MGR_A, role: 'manager', companyId: companyAId } as SessionPayload;
  mgrBSession = { sub: MGR_B, role: 'manager', companyId: companyBId } as SessionPayload;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

type NotifMeta = { requestId?: string; status?: string };

async function statusNotifications(userId: string): Promise<NotifMeta[]> {
  const rows = await prisma.notification.findMany({
    where: { userId, type: 'client_request_status_changed' },
    orderBy: { createdAt: 'asc' }
  });
  return rows.map((n) => (n.meta ?? {}) as NotifMeta);
}

describe('этап 5: заявки клиентов — полный путь на живом Postgres (integration)', () => {
  it('submitClientRequest партнёром: source=partner_cabinet, partnerId из сессии, статус submitted + аудит', async () => {
    const res = await submitClientRequest(prisma, partnerSession, {
      companyName: `${T}-ООО Клиент Партнёра`,
      inn: '7707 083893', // пробел внутри — нормализуется в 10 цифр
      contactName: 'Пётр Клиентов',
      contactPhone: '+7 900 111-22-33',
      subject: 'Обучение по охране труда',
      body: 'Нужно обучить 10 сотрудников'
    });
    if (!res.ok) throw new Error(`submit failed: ${JSON.stringify(res)}`);
    partnerRequestId = res.request.id;

    const row = await prisma.clientRequest.findUniqueOrThrow({ where: { id: partnerRequestId } });
    expect(row.source).toBe('partner_cabinet');
    expect(row.partnerId).toBe(partnerId);
    expect(row.organizationId).toBeNull();
    expect(row.submittedByUserId).toBe(PARTNER_USER);
    expect(row.status).toBe('submitted');
    expect(row.inn).toBe('7707083893');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'client_request_submitted', entityId: partnerRequestId, userId: PARTNER_USER }
    });
    expect(audit).not.toBeNull();
  });

  it('менеджер без companyId видит общую очередь и берёт заявку в triage; податель получает уведомление', async () => {
    // Партнёрская заявка без организации лежит в общей очереди — видна менеджеру с companyId=null.
    const queue = await listClientRequests(prisma, mgrGeneralSession, {});
    expect(queue.rows.map((r) => r.id)).toContain(partnerRequestId);

    const taken = await takeInTriage(prisma, mgrGeneralSession, { id: partnerRequestId });
    if (!taken.ok) throw new Error(`takeInTriage failed: ${JSON.stringify(taken)}`);
    expect(taken.request.status).toBe('in_triage');
    expect(taken.request.triagedByUserId).toBe(MGR_GENERAL);
    expect(taken.request.triagedAt).not.toBeNull();

    const metas = await statusNotifications(PARTNER_USER);
    const inTriage = metas.find((m) => m.requestId === partnerRequestId && m.status === 'in_triage');
    expect(inTriage).toBeDefined();
  });

  it('convertToLead: Lead с source=client_request/sourceRequestId/partnerId, заявка converted; повторный convert → lifecycle_violation', async () => {
    const res = await convertToLead(prisma, mgrGeneralSession, { id: partnerRequestId });
    if (!res.ok) throw new Error(`convertToLead failed: ${JSON.stringify(res)}`);
    convertedLeadId = res.lead.id;

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: convertedLeadId } });
    expect(lead.source).toBe('client_request');
    expect(lead.sourceRequestId).toBe(partnerRequestId);
    expect(lead.partnerId).toBe(partnerId);
    expect(lead.organizationId).toBeNull();
    expect(lead.createdByUserId).toBe(MGR_GENERAL);
    expect(lead.clientCompanyName).toBe(`${T}-ООО Клиент Партнёра`);
    expect(lead.status).toBe('new');

    const request = await prisma.clientRequest.findUniqueOrThrow({ where: { id: partnerRequestId } });
    expect(request.status).toBe('converted');

    // Уведомление подателю о converted.
    const metas = await statusNotifications(PARTNER_USER);
    expect(metas.some((m) => m.requestId === partnerRequestId && m.status === 'converted')).toBe(true);

    // Повторная конвертация — нарушение конвейера (роут отдал бы 409).
    const again = await convertToLead(prisma, mgrGeneralSession, { id: partnerRequestId });
    expect(again).toEqual({ ok: false, error: 'lifecycle_violation' });
    // И взять converted-заявку в triage тоже нельзя.
    const late = await takeInTriage(prisma, mgrGeneralSession, { id: partnerRequestId });
    expect(late).toEqual({ ok: false, error: 'lifecycle_violation' });
    // Лид остался ровно один.
    expect(await prisma.lead.count({ where: { sourceRequestId: partnerRequestId } })).toBe(1);
  });

  it('организация: submit от org-роли → organizationId; менеджер чужой компании и общей очереди её НЕ видят, свой — видит', async () => {
    const res = await submitClientRequest(prisma, orgSession, {
      companyName: `${T}-АО Клиент Организации`,
      contactName: 'Ольга Организаторова',
      contactEmail: `${T}-client-${RUN}@org.test`,
      subject: 'Поставка СИЗ'
    });
    if (!res.ok) throw new Error(`submit failed: ${JSON.stringify(res)}`);
    orgRequestId = res.request.id;

    const row = await prisma.clientRequest.findUniqueOrThrow({ where: { id: orgRequestId } });
    expect(row.source).toBe('organization_cabinet');
    expect(row.organizationId).toBe(org1Id);
    expect(row.partnerId).toBeNull();

    // Менеджер ДРУГОЙ компании: чужая заявка неотличима от несуществующей.
    expect(await getClientRequest(prisma, mgrBSession, orgRequestId)).toEqual({ ok: false, error: 'not_found' });
    // Менеджер без companyId (только общая очередь) — тоже не видит org-заявку.
    expect(await getClientRequest(prisma, mgrGeneralSession, orgRequestId)).toEqual({ ok: false, error: 'not_found' });

    // Менеджер её компании — видит (и recordPiiAccess не роняет выдачу).
    const mine = await getClientRequest(prisma, mgrASession, orgRequestId);
    if (!mine.ok) throw new Error(`expected ok, got ${JSON.stringify(mine)}`);
    expect(mine.request.organizationName).toBe(`${T}-Организация-${RUN}`);
    expect(mine.request.submittedByName).toBe('CR5 Организация');
  });

  it('reject с причиной: статус rejected, причина сохранена, податель уведомлён', async () => {
    const res = await rejectClientRequest(prisma, mgrASession, {
      id: orgRequestId,
      reason: 'Дубль существующей заявки'
    });
    if (!res.ok) throw new Error(`reject failed: ${JSON.stringify(res)}`);
    expect(res.request.status).toBe('rejected');
    expect(res.request.rejectedReason).toBe('Дубль существующей заявки');
    expect(res.request.triagedByUserId).toBe(MGR_A);

    const metas = await statusNotifications(ORG_USER);
    expect(metas.some((m) => m.requestId === orgRequestId && m.status === 'rejected')).toBe(true);
    // Текст уведомления доносит причину до подателя.
    const notif = await prisma.notification.findFirst({
      where: { userId: ORG_USER, type: 'client_request_status_changed' },
      orderBy: { createdAt: 'desc' }
    });
    expect(notif?.body).toContain('Дубль существующей заявки');

    // Повторный reject — нарушение конвейера.
    const again = await rejectClientRequest(prisma, mgrASession, { id: orgRequestId, reason: 'ещё раз' });
    expect(again).toEqual({ ok: false, error: 'lifecycle_violation' });
  });

  it('миграция Lead: прямой create с partnerId получает source=partner_legacy по default; partnerId nullable', async () => {
    const legacy = await prisma.lead.create({
      data: {
        partnerId,
        createdByUserId: PARTNER_USER,
        clientCompanyName: `${T}-Легаси Клиент`,
        clientContactName: 'Легаси Контакт',
        subject: 'Старый лид без source'
      }
    });
    expect(legacy.source).toBe('partner_legacy');
    expect(legacy.sourceRequestId).toBeNull();

    const orphan = await prisma.lead.create({
      data: {
        partnerId: null,
        createdByUserId: MGR_GENERAL,
        clientCompanyName: `${T}-Клиент Без Партнёра`,
        clientContactName: 'Контакт Без Партнёра',
        subject: 'Лид без партнёра'
      }
    });
    expect(orphan.partnerId).toBeNull();
    expect(orphan.source).toBe('partner_legacy');
  });

  it('листинг: податель видит только свои заявки; staff-листинг пишет piiAccessEvent и не роняет', async () => {
    // Партнёр — только свою (org-заявка не его).
    const partnerList = await listClientRequests(prisma, partnerSession, {});
    expect(partnerList.rows.map((r) => r.id)).toEqual([partnerRequestId]);

    // Организация — только свою.
    const orgList = await listClientRequests(prisma, orgSession, {});
    expect(orgList.rows.map((r) => r.id)).toEqual([orgRequestId]);

    // Менеджер компании А видит и заявку своей организации, и общую очередь.
    const mgrList = await listClientRequests(prisma, mgrASession, {});
    const mgrIds = mgrList.rows.map((r) => r.id);
    expect(mgrIds).toContain(orgRequestId);
    expect(mgrIds).toContain(partnerRequestId);
    // Этап 10 (§7 ТЗ): связь заявки с лидом наружу не отдаётся НИКОМУ —
    // DTO общий для клиента и staff, поле `convertedLeadId` удалено.
    const converted = mgrList.rows.find((r) => r.id === partnerRequestId);
    expect(converted).toBeDefined();
    expect(converted as Record<string, unknown>).not.toHaveProperty('convertedLeadId');
    expect(converted?.partnerName).toBe(`${T}-Партнёр-${RUN}`);

    // Журнал ПДн: staff-выдачи записаны (лист + деталка), клиентские — нет.
    const staffEvents = await prisma.piiAccessEvent.findMany({ where: { userId: MGR_A } });
    const contexts = staffEvents.map((e) => e.context);
    expect(contexts).toContain('client_requests_list');
    expect(contexts).toContain('client_request_view');
    const listEvent = staffEvents.find((e) => e.context === 'client_requests_list');
    expect(listEvent?.subjectIds).toContain(orgRequestId);
    expect(await prisma.piiAccessEvent.count({ where: { userId: { in: [PARTNER_USER, ORG_USER] } } })).toBe(0);

    // Фильтр статуса работает на живой БД.
    const rejectedOnly = await listClientRequests(prisma, mgrASession, { status: 'rejected' });
    expect(rejectedOnly.rows.map((r) => r.id)).toEqual([orgRequestId]);
  });
});
