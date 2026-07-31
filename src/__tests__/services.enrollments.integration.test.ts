import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import {
  approveEnrollment,
  rejectEnrollment,
  markProvisioned,
} from '@/lib/services/enrollments/lifecycle';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 2 (Модуль 2): интеграционный прогон «шапка + позиции» на живом Postgres —
 * транзакционность submit, зеркалирование статусов lifecycle, выборка list.
 * Фикстуры self-seeded и чистятся в afterAll (эталон — syncControl.integration).
 */

const prisma = new PrismaClient();
const T = 'enr2-int'; // префикс фикстур
const ACTOR = `${T}-admin`;

const admin: SessionPayload = { sub: ACTOR, role: 'admin' } as SessionPayload;

let directionId = '';
let inactiveDirectionId = '';
let orgId = '';
let studentId = '';
let foreignStudentId = '';

beforeAll(async () => {
  await prisma.user.upsert({
    where: { id: ACTOR },
    update: {},
    create: {
      id: ACTOR,
      email: `${ACTOR}@enr.test`,
      name: 'Enrollment Integration Admin',
      role: 'admin',
    },
  });
  const dir = await prisma.trainingDirection.create({
    data: { name: `${T}-Охрана труда`, sortOrder: 900 },
  });
  directionId = dir.id;
  const off = await prisma.trainingDirection.create({
    data: { name: `${T}-Выключенное`, isActive: false, sortOrder: 901 },
  });
  inactiveDirectionId = off.id;

  const org = await prisma.organization.create({ data: { name: `${T}-Организация` } });
  orgId = org.id;
  const st = await prisma.student.create({
    data: { name: 'Пётр Интеграционный', email: `${T}-p@org.test`, organizationId: orgId },
  });
  studentId = st.id;
  const org2 = await prisma.organization.create({ data: { name: `${T}-Чужая` } });
  const st2 = await prisma.student.create({
    data: { name: 'Чужой Слушатель', email: `${T}-alien@org.test`, organizationId: org2.id },
  });
  foreignStudentId = st2.id;
});

afterAll(async () => {
  await prisma.enrollmentRequest.deleteMany({ where: { submittedByUserId: ACTOR } });
  await prisma.student.deleteMany({ where: { email: { startsWith: T } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.trainingDirection.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.auditLog.deleteMany({ where: { userId: ACTOR } });
  // PR-2: lifecycle шлёт подателю enrollment_status_changed — чистим перед user.
  await prisma.notification.deleteMany({ where: { userId: ACTOR } });
  await prisma.user.deleteMany({ where: { id: ACTOR } });
  await prisma.$disconnect();
});

describe('submitEnrollmentRequest (integration)', () => {
  it('создаёт шапку с направлением и позиции одной транзакцией (снимок Student + ручные строки)', async () => {
    const res = await submitEnrollmentRequest(prisma, admin, {
      directionId,
      organizationId: orgId,
      note: 'интеграционный прогон',
      items: [
        { studentId },
        {
          fullName: 'Иван Ручной',
          email: `${T}-ivan@org.test`,
          position: 'инженер',
          snils: '112-233-445 95',
          birthDate: '1990-01-02',
          extra: 'нужна группа выходного дня',
        },
      ],
    });
    if (!res.ok) throw new Error(`expected ok, got ${JSON.stringify(res)}`);
    expect(res.itemCount).toBe(2);

    const saved = await prisma.enrollmentRequest.findUniqueOrThrow({
      where: { id: res.request.id },
      include: { items: { orderBy: { createdAt: 'asc' } }, direction: true },
    });
    expect(saved.direction?.name).toBe(`${T}-Охрана труда`);
    expect(saved.items).toHaveLength(2);
    const fromStudent = saved.items.find((i) => i.studentId === studentId)!;
    expect(fromStudent.fullName).toBe('Пётр Интеграционный');
    const manual = saved.items.find((i) => !i.studentId)!;
    expect(manual).toMatchObject({
      fullName: 'Иван Ручной',
      position: 'инженер',
      snils: '11223344595',
      extra: 'нужна группа выходного дня',
    });
    expect(manual.birthDate?.toISOString()).toBe('1990-01-02T00:00:00.000Z');
  });

  it('неактивное направление → validation; чужой studentId → forbidden (ничего не создано)', async () => {
    const before = await prisma.enrollmentRequest.count({ where: { submittedByUserId: ACTOR } });

    const badDir = await submitEnrollmentRequest(prisma, admin, {
      directionId: inactiveDirectionId,
      organizationId: orgId,
      items: [{ fullName: 'X', email: `${T}-x@org.test` }],
    });
    expect(badDir).toMatchObject({ ok: false, error: 'validation' });

    const alien = await submitEnrollmentRequest(prisma, admin, {
      directionId,
      organizationId: orgId,
      items: [{ studentId: foreignStudentId }],
    });
    expect(alien).toEqual({ ok: false, error: 'forbidden' });

    expect(await prisma.enrollmentRequest.count({ where: { submittedByUserId: ACTOR } })).toBe(
      before
    );
  });
});

describe('lifecycle (integration): статусы зеркалируются в позиции', () => {
  async function createRequest() {
    const res = await submitEnrollmentRequest(prisma, admin, {
      directionId,
      organizationId: orgId,
      items: [
        { fullName: 'А', email: `${T}-a-${Date.now()}@org.test` },
        { fullName: 'Б', email: `${T}-b-${Date.now()}@org.test` },
      ],
    });
    if (!res.ok) throw new Error('seed failed');
    return res.request.id;
  }

  it('approve → позиции approved; markProvisioned (multi, без id) → позиции provisioned', async () => {
    const id = await createRequest();
    const ap = await approveEnrollment(prisma, { id, reviewerId: ACTOR });
    expect(ap.ok).toBe(true);
    let items = await prisma.enrollmentRequestItem.findMany({ where: { requestId: id } });
    expect(items.map((i) => i.status)).toEqual(['approved', 'approved']);

    const prov = await markProvisioned(prisma, { id, reviewerId: ACTOR });
    expect(prov.ok).toBe(true);
    items = await prisma.enrollmentRequestItem.findMany({ where: { requestId: id } });
    expect(items.map((i) => i.status)).toEqual(['provisioned', 'provisioned']);
  });

  it('reject → все позиции rejected', async () => {
    const id = await createRequest();
    const rj = await rejectEnrollment(prisma, {
      id,
      reviewerId: ACTOR,
      reason: 'интеграционный отказ',
    });
    expect(rj.ok).toBe(true);
    const items = await prisma.enrollmentRequestItem.findMany({ where: { requestId: id } });
    expect(items.every((i) => i.status === 'rejected')).toBe(true);
  });

  it('list: directionName из справочника, счётчик позиций, поиск по ФИО позиции', async () => {
    const { rows } = await listEnrollmentRequests(prisma, admin, { search: 'Пётр Интеграционный' });
    const mine = rows.find((r) => r.firstStudentName === 'Пётр Интеграционный');
    expect(mine).toBeDefined();
    expect(mine!.directionName).toBe(`${T}-Охрана труда`);
    expect(mine!.studentCount).toBe(2);
  });
});
