/**
 * Этап 1 ТЗ v0.5 (§11) — матрица доступа к настраиваемым полям пяти сущностей.
 *
 * До этого этапа значения полей жили только у заказа, и скоуп был вшит в
 * values.ts. Сущностей стало пять, поэтому доступ проверяется здесь на живой
 * базе, а не моками: подмена Prisma спрятала бы именно то, что важно —
 * межкомпанийную и межконтрагентскую изоляцию.
 *
 * Ключевой регресс файла: партнёр A не видит и не пишет карточки контура B.
 *
 * Требует живой Postgres.
 * Запуск: npm run test:integration -- services.customFields.access
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { resolveEntityAccess } from '@/lib/services/customFields/access';
import { createDefinition } from '@/lib/services/customFields/definitions';
import { getValuesForEntity, setValues } from '@/lib/services/customFields/values';

let prisma: PrismaClient;

const S = Date.now();

// Контур A
let companyA: string;
let partnerA: string;
let orgA: string;
let studentA: string;
let orderA: string;
let docA: string; // документ заказа A
let generalDocA: string; // общий документ организации A

// Контур B (чужой)
let companyB: string;
let partnerB: string;
let orgB: string;
let orderB: string;

// Пользователи
let adminId: string;
let managerAId: string;
let leaderAId: string;
let partnerAUserId: string;
let partnerBUserId: string;
let orgAUserId: string;

// Определения
let defOrgId: string; // организация, правит только admin+leader (дефолт)
let defOrderId: string; // заявка, правит только admin+leader (дефолт)
let defStudentId: string; // сотрудник, правит организация
let defDocId: string; // документ, видит только admin

function sess(userId: string, role: string, extra: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: userId, role: role as SessionPayload['role'], ...extra } as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const mk = (email: string, role: string, name: string) =>
    prisma.user.create({ data: { email, passwordHash: 'x', name, role: role as 'admin' } });

  adminId = (await mk(`cfa-admin-${S}@t.local`, 'admin', 'CFA Admin')).id;
  managerAId = (await mk(`cfa-mgr-${S}@t.local`, 'manager', 'CFA Manager')).id;
  leaderAId = (await mk(`cfa-leader-${S}@t.local`, 'manager', 'CFA Leader')).id;
  partnerAUserId = (await mk(`cfa-pa-${S}@t.local`, 'partner', 'CFA PartnerA')).id;
  partnerBUserId = (await mk(`cfa-pb-${S}@t.local`, 'partner', 'CFA PartnerB')).id;
  orgAUserId = (await mk(`cfa-org-${S}@t.local`, 'organization', 'CFA OrgUser')).id;

  companyA = (await prisma.company.create({ data: { name: `CFA-CoA-${S}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `CFA-CoB-${S}` } })).id;

  partnerA = (await prisma.partner.create({ data: { name: `CFA-PA-${S}`, commissionRate: 0.1 } }))
    .id;
  partnerB = (await prisma.partner.create({ data: { name: `CFA-PB-${S}`, commissionRate: 0.1 } }))
    .id;

  orgA = (
    await prisma.organization.create({
      data: { name: `CFA-OrgA-${S}`, partnerId: partnerA, companyId: companyA },
    })
  ).id;
  orgB = (
    await prisma.organization.create({
      data: { name: `CFA-OrgB-${S}`, partnerId: partnerB, companyId: companyB },
    })
  ).id;

  await prisma.organizationManager.create({
    data: { organizationId: orgA, userId: managerAId, isActive: true },
  });

  studentA = (
    await prisma.student.create({
      data: { name: `CFA-Student-${S}`, email: `cfa-student-${S}@t.local`, organizationId: orgA },
    })
  ).id;

  orderA = (
    await prisma.order.create({
      data: {
        title: `CFA-OrderA-${S}`,
        orderNumber: `CFA-ONA-${S}`,
        companyId: companyA,
        partnerId: partnerA,
        organizationId: orgA,
        executionStatus: 'in_progress',
      },
    })
  ).id;

  orderB = (
    await prisma.order.create({
      data: {
        title: `CFA-OrderB-${S}`,
        orderNumber: `CFA-ONB-${S}`,
        companyId: companyB,
        partnerId: partnerB,
        organizationId: orgB,
        executionStatus: 'in_progress',
      },
    })
  ).id;

  docA = (
    await prisma.document.create({
      data: {
        name: `CFA-DocA-${S}`,
        path: `p/${S}/a`,
        mimeType: 'application/pdf',
        counterpartyType: 'organization',
        counterpartyId: orgA,
        orderId: orderA,
      },
    })
  ).id;

  generalDocA = (
    await prisma.document.create({
      data: {
        name: `CFA-GenDocA-${S}`,
        path: `p/${S}/gen`,
        mimeType: 'application/pdf',
        counterpartyType: 'organization',
        counterpartyId: orgA,
        companyId: companyA,
      },
    })
  ).id;

  const admin = sess(adminId, 'admin');

  const dOrg = await createDefinition(prisma, admin, {
    entityType: 'organization',
    key: `cfa_org_note_${S}`,
    label: 'Заметка по организации',
    fieldType: 'text',
    sortOrder: 1,
  });
  if (!dOrg.ok) throw new Error(`org def: ${dOrg.error}`);
  defOrgId = dOrg.definition.id;

  const dOrder = await createDefinition(prisma, admin, {
    entityType: 'order',
    key: `cfa_order_note_${S}`,
    label: 'Заметка по заявке',
    fieldType: 'text',
    sortOrder: 1,
  });
  if (!dOrder.ok) throw new Error(`order def: ${dOrder.error}`);
  defOrderId = dOrder.definition.id;

  const dStudent = await createDefinition(prisma, admin, {
    entityType: 'student',
    key: `cfa_student_note_${S}`,
    label: 'Заметка по сотруднику',
    fieldType: 'textarea',
    sortOrder: 1,
    editableByRoles: ['organization'],
  });
  if (!dStudent.ok) throw new Error(`student def: ${dStudent.error}`);
  defStudentId = dStudent.definition.id;

  const dDoc = await createDefinition(prisma, admin, {
    entityType: 'document',
    key: `cfa_doc_note_${S}`,
    label: 'Служебная пометка',
    fieldType: 'text',
    sortOrder: 1,
    visibleToRoles: ['admin'],
  });
  if (!dDoc.ok) throw new Error(`doc def: ${dDoc.error}`);
  defDocId = dDoc.definition.id;
});

afterAll(async () => {
  await prisma.customFieldValue.deleteMany({
    where: { definitionId: { in: [defOrgId, defOrderId, defStudentId, defDocId] } },
  });
  await prisma.customFieldDefinition.deleteMany({
    where: { id: { in: [defOrgId, defOrderId, defStudentId, defDocId] } },
  });
  await prisma.document.deleteMany({ where: { name: { startsWith: `CFA-` } } });
  await prisma.order.deleteMany({ where: { title: { startsWith: `CFA-` } } });
  await prisma.student.deleteMany({ where: { name: { startsWith: `CFA-` } } });
  await prisma.organizationManager.deleteMany({ where: { userId: { in: [managerAId] } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: `CFA-` } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: `CFA-` } } });
  await prisma.auditLog.deleteMany({
    where: {
      userId: { in: [adminId, managerAId, leaderAId, partnerAUserId, partnerBUserId, orgAUserId] },
    },
  });
  await prisma.user.deleteMany({ where: { email: { contains: `cfa-` } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: `CFA-Co` } } });
  await prisma.$disconnect();
});

// ─── Доступ к карточке ───────────────────────────────────────────────────────

describe('resolveEntityAccess — заявка', () => {
  it('менеджер в скоупе — да, вне скоупа — нет', async () => {
    const mgr = sess(managerAId, 'manager', { companyId: companyA, managedOrgIds: [orgA] });
    expect((await resolveEntityAccess(prisma, mgr, 'order', orderA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, mgr, 'order', orderB)).canRead).toBe(false);
  });

  it('руководитель видит заявки своей компании и не видит чужую', async () => {
    const leader = sess(leaderAId, 'manager', { companyId: companyA, managerRole: 'leader' });
    expect((await resolveEntityAccess(prisma, leader, 'order', orderA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, leader, 'order', orderB)).canRead).toBe(false);
  });

  it('партнёр видит только свои заявки', async () => {
    const pa = sess(partnerAUserId, 'partner', { partnerId: partnerA });
    expect((await resolveEntityAccess(prisma, pa, 'order', orderA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, pa, 'order', orderB)).canRead).toBe(false);
  });

  it('организация видит только свои заявки', async () => {
    const org = sess(orgAUserId, 'organization', { organizationId: orgA });
    expect((await resolveEntityAccess(prisma, org, 'order', orderA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, org, 'order', orderB)).canRead).toBe(false);
  });

  it('администратор видит любую существующую и не видит выдуманную', async () => {
    const admin = sess(adminId, 'admin');
    expect((await resolveEntityAccess(prisma, admin, 'order', orderB)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, admin, 'order', 'no-such-id')).canRead).toBe(false);
  });

  it('слушатель не допускается никуда', async () => {
    const student = sess('anon', 'student');
    expect((await resolveEntityAccess(prisma, student, 'order', orderA)).canRead).toBe(false);
  });
});

describe('resolveEntityAccess — организация, партнёр, сотрудник', () => {
  it('организация: партнёр A — своя, чужая — нет', async () => {
    const pa = sess(partnerAUserId, 'partner', { partnerId: partnerA });
    expect((await resolveEntityAccess(prisma, pa, 'organization', orgA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, pa, 'organization', orgB)).canRead).toBe(false);
  });

  it('организация: клиент видит свою карточку и не видит чужую', async () => {
    const org = sess(orgAUserId, 'organization', { organizationId: orgA });
    expect((await resolveEntityAccess(prisma, org, 'organization', orgA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, org, 'organization', orgB)).canRead).toBe(false);
  });

  it('организация: менеджер — по своему скоупу', async () => {
    const mgr = sess(managerAId, 'manager', { companyId: companyA, managedOrgIds: [orgA] });
    expect((await resolveEntityAccess(prisma, mgr, 'organization', orgA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, mgr, 'organization', orgB)).canRead).toBe(false);
  });

  it('партнёр: своя карточка — да, чужая — нет', async () => {
    const pa = sess(partnerAUserId, 'partner', { partnerId: partnerA });
    expect((await resolveEntityAccess(prisma, pa, 'partner', partnerA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, pa, 'partner', partnerB)).canRead).toBe(false);
  });

  it('партнёр: менеджер читает партнёра своей компании, чужого — нет', async () => {
    const mgr = sess(managerAId, 'manager', { companyId: companyA, managedOrgIds: [orgA] });
    expect((await resolveEntityAccess(prisma, mgr, 'partner', partnerA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, mgr, 'partner', partnerB)).canRead).toBe(false);
  });

  it('партнёр: организация чужие карточки партнёров не читает', async () => {
    const org = sess(orgAUserId, 'organization', { organizationId: orgA });
    expect((await resolveEntityAccess(prisma, org, 'partner', partnerA)).canRead).toBe(false);
  });

  it('сотрудник: доступ наследуется от его организации', async () => {
    const org = sess(orgAUserId, 'organization', { organizationId: orgA });
    const pb = sess(partnerBUserId, 'partner', { partnerId: partnerB });
    expect((await resolveEntityAccess(prisma, org, 'student', studentA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, pb, 'student', studentA)).canRead).toBe(false);
  });

  it('несуществующие id дают отказ и клиентским ролям (не только админу)', async () => {
    const org = sess(orgAUserId, 'organization', { organizationId: orgA });
    const pa = sess(partnerAUserId, 'partner', { partnerId: partnerA });
    const mgr = sess(managerAId, 'manager', { companyId: companyA, managedOrgIds: [orgA] });
    expect((await resolveEntityAccess(prisma, org, 'order', 'nope')).canRead).toBe(false);
    expect((await resolveEntityAccess(prisma, org, 'organization', 'nope')).canRead).toBe(false);
    expect((await resolveEntityAccess(prisma, pa, 'partner', 'nope')).canRead).toBe(false);
    expect((await resolveEntityAccess(prisma, org, 'student', 'nope')).canRead).toBe(false);
    expect((await resolveEntityAccess(prisma, mgr, 'document', 'nope')).canRead).toBe(false);
  });

  it('несуществующие id везде дают отказ, а не исключение', async () => {
    const admin = sess(adminId, 'admin');
    for (const entity of ['organization', 'partner', 'student', 'document'] as const) {
      expect((await resolveEntityAccess(prisma, admin, entity, 'nope')).canRead).toBe(false);
    }
  });
});

describe('resolveEntityAccess — документ', () => {
  it('документ заказа: доступ наследуется от заказа', async () => {
    const pa = sess(partnerAUserId, 'partner', { partnerId: partnerA });
    const pb = sess(partnerBUserId, 'partner', { partnerId: partnerB });
    expect((await resolveEntityAccess(prisma, pa, 'document', docA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, pb, 'document', docA)).canRead).toBe(false);
  });

  it('документ заказа: менеджер в скоупе — да', async () => {
    const mgr = sess(managerAId, 'manager', { companyId: companyA, managedOrgIds: [orgA] });
    expect((await resolveEntityAccess(prisma, mgr, 'document', docA)).canRead).toBe(true);
  });

  it('документ заказа: руководитель — по своей компании', async () => {
    const leader = sess(leaderAId, 'manager', { companyId: companyA, managerRole: 'leader' });
    expect((await resolveEntityAccess(prisma, leader, 'document', docA)).canRead).toBe(true);
  });

  it('документ заказа: организация видит документ своей заявки', async () => {
    const org = sess(orgAUserId, 'organization', { organizationId: orgA });
    const foreignOrg = sess(orgAUserId, 'organization', { organizationId: orgB });
    expect((await resolveEntityAccess(prisma, org, 'document', docA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, foreignOrg, 'document', docA)).canRead).toBe(false);
  });

  it('документ заказа: менеджер вне скоупа — отказ', async () => {
    const mgr = sess(managerAId, 'manager', { companyId: companyA, managedOrgIds: [] });
    expect((await resolveEntityAccess(prisma, mgr, 'document', docA)).canRead).toBe(false);
  });

  it('общий документ партнёра: доступ по контрагенту-партнёру', async () => {
    const generalDocP = await prisma.document.create({
      data: {
        name: `CFA-GenDocP-${S}`,
        path: `p/${S}/genp`,
        mimeType: 'application/pdf',
        counterpartyType: 'partner',
        counterpartyId: partnerA,
        companyId: companyA,
      },
    });
    const pa = sess(partnerAUserId, 'partner', { partnerId: partnerA });
    const pb = sess(partnerBUserId, 'partner', { partnerId: partnerB });
    expect((await resolveEntityAccess(prisma, pa, 'document', generalDocP.id)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, pb, 'document', generalDocP.id)).canRead).toBe(false);
    await prisma.document.delete({ where: { id: generalDocP.id } });
  });

  it('организация видит свою карточку и через членство, и через закрепление', async () => {
    // Три канала привязки клиента к организации: прямое поле сессии, членство
    // (organizationMemberships) и assignedOrgIds. Проверяем все, иначе часть
    // клиентов «внезапно» теряет доступ при смене способа входа.
    const byMembership = sess(orgAUserId, 'organization', {
      organizationMemberships: [{ organizationId: orgA, roleInOrg: 'member', isActive: true }],
    });
    const byAssigned = sess(orgAUserId, 'organization', { assignedOrgIds: [orgA] });
    const inactiveMembership = sess(orgAUserId, 'organization', {
      organizationMemberships: [{ organizationId: orgA, roleInOrg: 'member', isActive: false }],
    });
    expect((await resolveEntityAccess(prisma, byMembership, 'organization', orgA)).canRead).toBe(
      true
    );
    expect((await resolveEntityAccess(prisma, byAssigned, 'organization', orgA)).canRead).toBe(
      true
    );
    expect(
      (await resolveEntityAccess(prisma, inactiveMembership, 'organization', orgA)).canRead
    ).toBe(false);
  });

  it('менеджер без компании к карточке партнёра не допускается', async () => {
    const noCompany = sess(managerAId, 'manager', { companyId: null, managedOrgIds: [orgA] });
    expect((await resolveEntityAccess(prisma, noCompany, 'partner', partnerA)).canRead).toBe(false);
  });

  it('партнёр без partnerId в сессии не проходит нигде', async () => {
    const broken = sess(partnerAUserId, 'partner', { partnerId: null });
    expect((await resolveEntityAccess(prisma, broken, 'order', orderA)).canRead).toBe(false);
    expect((await resolveEntityAccess(prisma, broken, 'organization', orgA)).canRead).toBe(false);
    expect((await resolveEntityAccess(prisma, broken, 'document', docA)).canRead).toBe(false);
  });

  it('общий документ (без заказа): доступ по контрагенту', async () => {
    const org = sess(orgAUserId, 'organization', { organizationId: orgA });
    const pb = sess(partnerBUserId, 'partner', { partnerId: partnerB });
    expect((await resolveEntityAccess(prisma, org, 'document', generalDocA)).canRead).toBe(true);
    expect((await resolveEntityAccess(prisma, pb, 'document', generalDocA)).canRead).toBe(false);
  });
});

// ─── Право записи = скоуп ∧ роль ─────────────────────────────────────────────

describe('setValues — скоуп и роль перемножаются', () => {
  it('администратор пишет значение организации', async () => {
    const admin = sess(adminId, 'admin');
    const res = await setValues(prisma, admin, 'organization', orgA, { [defOrgId]: 'проверено' });
    expect(res).toEqual({ ok: true });
  });

  it('менеджер в скоупе, но без права правки → forbidden (дефолт Q1)', async () => {
    const mgr = sess(managerAId, 'manager', { companyId: companyA, managedOrgIds: [orgA] });
    const res = await setValues(prisma, mgr, 'organization', orgA, { [defOrgId]: 'нельзя' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('руководитель правит по дефолту (заявка своей компании)', async () => {
    const leader = sess(leaderAId, 'manager', { companyId: companyA, managerRole: 'leader' });
    const res = await setValues(prisma, leader, 'order', orderA, {
      [defOrderId]: 'от руководителя',
    });
    expect(res).toEqual({ ok: true });
  });

  it('руководитель правит поля организации своей компании без закрепления', async () => {
    // Решение заказчика 29.07.2026: лидер-инвариант C8 распространён с заказов
    // на организации. До этого руководитель без закреплённых организаций не мог
    // ни открыть карточку, ни заполнить поля §11, хотя §4 ТЗ даёт ему настройку
    // полей. Граница компании при этом сохраняется — см. следующую проверку.
    const leader = sess(leaderAId, 'manager', { companyId: companyA, managerRole: 'leader' });
    const res = await setValues(prisma, leader, 'organization', orgA, {
      [defOrgId]: 'от руководителя',
    });
    expect(res).toEqual({ ok: true });
  });

  it('руководитель НЕ дотягивается до организации чужой компании', async () => {
    const leader = sess(leaderAId, 'manager', { companyId: companyA, managerRole: 'leader' });
    const res = await setValues(prisma, leader, 'organization', orgB, { [defOrgId]: 'чужое' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('ИЗОЛЯЦИЯ: партнёр B не пишет в карточку организации контура A', async () => {
    const pb = sess(partnerBUserId, 'partner', { partnerId: partnerB });
    const res = await setValues(prisma, pb, 'organization', orgA, { [defOrgId]: 'взлом' });
    expect(res).toEqual({ ok: false, error: 'not_found' });

    // и значение в базе не изменилось
    const row = await prisma.customFieldValue.findUnique({
      where: { definitionId_entityId: { definitionId: defOrgId, entityId: orgA } },
    });
    expect(row?.value).toBe('от руководителя');
  });

  it('деактивированное поле не пишется, но и не роняет сохранение', async () => {
    const admin = sess(adminId, 'admin');
    const dOff = await createDefinition(prisma, admin, {
      entityType: 'organization',
      key: `cfa_off_${S}`,
      label: 'Выключенное',
      fieldType: 'text',
      sortOrder: 9,
    });
    if (!dOff.ok) throw new Error('unexpected');
    await prisma.customFieldDefinition.update({
      where: { id: dOff.definition.id },
      data: { isActive: false },
    });

    const res = await setValues(prisma, admin, 'organization', orgA, {
      [dOff.definition.id]: 'мимо',
    });
    expect(res).toEqual({ ok: true });
    const row = await prisma.customFieldValue.findUnique({
      where: { definitionId_entityId: { definitionId: dOff.definition.id, entityId: orgA } },
    });
    expect(row).toBeNull();

    await prisma.customFieldDefinition.delete({ where: { id: dOff.definition.id } });
  });

  it('пустой набор значений — успех без записи', async () => {
    const admin = sess(adminId, 'admin');
    expect(await setValues(prisma, admin, 'organization', orgA, {})).toEqual({ ok: true });
  });

  it('неизвестная сущность отвергается до обращения к базе', async () => {
    const admin = sess(adminId, 'admin');
    const res = await setValues(prisma, admin, 'invoice', orgA, { [defOrgId]: 'x' });
    expect(res).toEqual({ ok: false, error: 'invalid_entity_type' });
  });

  it('слушатель не пишет ничего', async () => {
    const student = sess('anon', 'student');
    const res = await setValues(prisma, student, 'organization', orgA, { [defOrgId]: 'x' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

// ─── Видимость поля ──────────────────────────────────────────────────────────

describe('getValuesForEntity — фильтр по ролям на сервере', () => {
  it('поле с visibleToRoles=[admin] не доезжает до менеджера', async () => {
    const admin = sess(adminId, 'admin');
    const mgr = sess(managerAId, 'manager', { companyId: companyA, managedOrgIds: [orgA] });

    const forAdmin = await getValuesForEntity(prisma, admin, 'document', docA);
    expect(forAdmin.ok).toBe(true);
    if (!forAdmin.ok) throw new Error('unexpected');
    expect(forAdmin.fields.map((f) => f.definition.id)).toContain(defDocId);

    const forMgr = await getValuesForEntity(prisma, mgr, 'document', docA);
    expect(forMgr.ok).toBe(true);
    if (!forMgr.ok) throw new Error('unexpected');
    expect(forMgr.fields.map((f) => f.definition.id)).not.toContain(defDocId);
  });

  it('флаг editable считается по роли, а не по кабинету', async () => {
    const mgr = sess(managerAId, 'manager', { companyId: companyA, managedOrgIds: [orgA] });
    const leader = sess(leaderAId, 'manager', { companyId: companyA, managerRole: 'leader' });

    const forMgr = await getValuesForEntity(prisma, mgr, 'organization', orgA);
    const forLeader = await getValuesForEntity(prisma, leader, 'organization', orgA);
    if (!forMgr.ok || !forLeader.ok) throw new Error('unexpected');

    const mgrField = forMgr.fields.find((f) => f.definition.id === defOrgId);
    const leaderField = forLeader.fields.find((f) => f.definition.id === defOrgId);
    expect(mgrField?.definition.editable).toBe(false);
    expect(leaderField?.definition.editable).toBe(true);
  });

  it('неизвестная сущность → invalid_entity_type', async () => {
    const admin = sess(adminId, 'admin');
    const res = await getValuesForEntity(prisma, admin, 'invoice', orgA);
    expect(res).toEqual({ ok: false, error: 'invalid_entity_type' });
  });
});
