import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import { approveEnrollment, markProvisioned, advanceEnrollmentItems } from '@/lib/services/enrollments/lifecycle';
import { getEnrollmentRequest } from '@/lib/services/enrollments/detail';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 2 PR-2: интеграционный прогон на живом Postgres — полный конвейер
 * позиций (provisioned → in_training → certificates_ready) с агрегацией
 * статуса шапки, уведомление подателю на смену статуса (глобальный
 * prisma-синглтон notify пишет в ту же тестовую БД), скоуп деталки.
 * Фикстуры self-seeded, суффикс pr2, чистятся в afterAll
 * (эталон — services.enrollments.integration.test.ts).
 */

const prisma = new PrismaClient();
const T = 'enr-pr2-int'; // префикс фикстур (уникален, чтобы не конфликтовать с enr2-int)
const SUBMITTER = `${T}-submitter`;
const REVIEWER = `${T}-reviewer`;

let directionId = '';
let orgId = '';

let submitterSession: SessionPayload;

beforeAll(async () => {
  await prisma.user.upsert({
    where: { id: SUBMITTER },
    update: {},
    create: { id: SUBMITTER, email: `${SUBMITTER}@enr.test`, name: 'PR2 Податель', role: 'organization' }
  });
  await prisma.user.upsert({
    where: { id: REVIEWER },
    update: {},
    create: { id: REVIEWER, email: `${REVIEWER}@enr.test`, name: 'PR2 Ревьюер', role: 'admin' }
  });
  const dir = await prisma.trainingDirection.create({ data: { name: `${T}-Пожарная безопасность`, sortOrder: 910 } });
  directionId = dir.id;
  const org = await prisma.organization.create({ data: { name: `${T}-Организация` } });
  orgId = org.id;

  submitterSession = {
    sub: SUBMITTER,
    role: 'organization',
    organizationMemberships: [{ organizationId: orgId, roleInOrg: 'admin', isActive: true }]
  } as SessionPayload;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [SUBMITTER, REVIEWER] } } });
  await prisma.enrollmentRequest.deleteMany({ where: { submittedByUserId: SUBMITTER } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.trainingDirection.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [SUBMITTER, REVIEWER] } } });
  await prisma.user.deleteMany({ where: { id: { in: [SUBMITTER, REVIEWER] } } });
  await prisma.$disconnect();
});

async function itemStatuses(requestId: string): Promise<string[]> {
  const items = await prisma.enrollmentRequestItem.findMany({
    where: { requestId },
    orderBy: { id: 'asc' },
    select: { status: true }
  });
  return items.map((i) => i.status);
}

async function headerStatus(requestId: string): Promise<string> {
  const r = await prisma.enrollmentRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } });
  return r.status;
}

describe('PR-2 конвейер позиций + уведомления + деталка (integration)', () => {
  let requestId = '';
  let itemA = '';
  let itemB = '';

  it('submit (2 позиции) → approve → markProvisioned: позиции зеркалируются', async () => {
    const res = await submitEnrollmentRequest(prisma, submitterSession, {
      directionId,
      organizationId: orgId,
      items: [
        { fullName: 'Анна ПР2', email: `${T}-anna@org.test` },
        { fullName: 'Борис ПР2', email: `${T}-boris@org.test` }
      ]
    });
    if (!res.ok) throw new Error(`submit failed: ${JSON.stringify(res)}`);
    requestId = res.request.id;

    const items = await prisma.enrollmentRequestItem.findMany({
      where: { requestId },
      orderBy: { id: 'asc' },
      select: { id: true }
    });
    expect(items).toHaveLength(2);
    itemA = items[0].id;
    itemB = items[1].id;

    const ap = await approveEnrollment(prisma, { id: requestId, reviewerId: REVIEWER });
    expect(ap.ok).toBe(true);
    expect(await itemStatuses(requestId)).toEqual(['approved', 'approved']);

    const prov = await markProvisioned(prisma, { id: requestId, reviewerId: REVIEWER });
    expect(prov.ok).toBe(true);
    expect(await itemStatuses(requestId)).toEqual(['provisioned', 'provisioned']);
    expect(await headerStatus(requestId)).toBe('provisioned');
  });

  it('после approve податель получил Notification type enrollment_status_changed', async () => {
    const rows = await prisma.notification.findMany({
      where: { userId: SUBMITTER, type: 'enrollment_status_changed' },
      orderBy: { createdAt: 'asc' }
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const approved = rows.find(
      (n) => (n.meta as { requestId?: string; status?: string })?.requestId === requestId &&
        (n.meta as { status?: string })?.status === 'approved'
    );
    expect(approved).toBeDefined();
    expect(approved!.title).toContain('Заявка на обучение');
    expect(approved!.organizationId).toBe(orgId);
  });

  it('advance in_training одной позиции (itemIds) → шапка осталась provisioned', async () => {
    const r = await advanceEnrollmentItems(prisma, {
      id: requestId,
      reviewerId: REVIEWER,
      target: 'in_training',
      itemIds: [itemA]
    });
    if (!r.ok) throw new Error(`advance failed: ${JSON.stringify(r)}`);
    expect(r.movedCount).toBe(1);
    expect(r.headerChanged).toBe(false);
    expect(await itemStatuses(requestId)).toEqual(['in_training', 'provisioned']);
    // Агрегат шапки — минимальный по конвейеру статус не-отклонённых позиций.
    expect(await headerStatus(requestId)).toBe('provisioned');
  });

  it('lifecycle_violation: повторный advance той же позиции; validation: чужой itemId', async () => {
    // itemA уже in_training — со шага provisioned его не сдвинуть второй раз.
    const again = await advanceEnrollmentItems(prisma, {
      id: requestId,
      reviewerId: REVIEWER,
      target: 'in_training',
      itemIds: [itemA]
    });
    expect(again).toEqual({ ok: false, error: 'lifecycle_violation' });

    // Чужой (несуществующий в заявке) itemId → validation, ничего не сдвинуто.
    const alien = await advanceEnrollmentItems(prisma, {
      id: requestId,
      reviewerId: REVIEWER,
      target: 'in_training',
      itemIds: ['alien-item-pr2']
    });
    expect(alien).toEqual({ ok: false, error: 'validation' });
    expect(await itemStatuses(requestId)).toEqual(['in_training', 'provisioned']);
  });

  it('advance второй позиции → шапка in_training; certificates_ready все → шапка certificates_ready', async () => {
    const second = await advanceEnrollmentItems(prisma, {
      id: requestId,
      reviewerId: REVIEWER,
      target: 'in_training',
      itemIds: [itemB]
    });
    if (!second.ok) throw new Error(`advance failed: ${JSON.stringify(second)}`);
    expect(second.headerChanged).toBe(true);
    expect(await itemStatuses(requestId)).toEqual(['in_training', 'in_training']);
    expect(await headerStatus(requestId)).toBe('in_training');

    // Без itemIds — все позиции на предыдущем шаге конвейера.
    const ready = await advanceEnrollmentItems(prisma, {
      id: requestId,
      reviewerId: REVIEWER,
      target: 'certificates_ready'
    });
    if (!ready.ok) throw new Error(`advance failed: ${JSON.stringify(ready)}`);
    expect(ready.movedCount).toBe(2);
    expect(await itemStatuses(requestId)).toEqual(['certificates_ready', 'certificates_ready']);
    expect(await headerStatus(requestId)).toBe('certificates_ready');

    // Смена статуса шапки на in_training и certificates_ready тоже уведомила подателя.
    const statuses = (
      await prisma.notification.findMany({ where: { userId: SUBMITTER, type: 'enrollment_status_changed' } })
    ).map((n) => (n.meta as { status?: string })?.status);
    expect(statuses).toContain('in_training');
    expect(statuses).toContain('certificates_ready');
  });

  it('getEnrollmentRequest: податель видит свою заявку (recordPiiAccess не роняет), чужой — not_found', async () => {
    const mine = await getEnrollmentRequest(prisma, submitterSession, requestId);
    if (!mine.ok) throw new Error(`expected ok, got ${JSON.stringify(mine)}`);
    expect(mine.request.directionName).toBe(`${T}-Пожарная безопасность`);
    expect(mine.request.items).toHaveLength(2);
    expect(mine.request.items.map((i) => i.status)).toEqual(['certificates_ready', 'certificates_ready']);

    // Пользователь другого партнёра: скоуп по partnerId → заявка неотличима от несуществующей.
    const alienPartner = {
      sub: `${T}-alien`,
      role: 'partner',
      partnerId: `${T}-no-such-partner`
    } as SessionPayload;
    const foreign = await getEnrollmentRequest(prisma, alienPartner, requestId);
    expect(foreign).toEqual({ ok: false, error: 'not_found' });

    // Организация без членства в нашей организации — тоже not_found.
    const alienOrg = {
      sub: `${T}-alien-org`,
      role: 'organization',
      organizationMemberships: []
    } as unknown as SessionPayload;
    const foreignOrg = await getEnrollmentRequest(prisma, alienOrg, requestId);
    expect(foreignOrg).toEqual({ ok: false, error: 'not_found' });
  });
});
