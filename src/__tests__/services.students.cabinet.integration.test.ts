import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import {
  approveEnrollment,
  rejectEnrollment,
  setEnrollmentItemDates,
} from '@/lib/services/enrollments/lifecycle';
import { getStudentCabinet } from '@/lib/services/students/cabinet';
import { linkStudentCardsToAccount } from '@/lib/services/students/account';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 2 ТЗ 13.10.2026 «Кабинет слушателя», PR-1 (`У-284`, `У-273`,
 * `Р-2-1`…`Р-2-4`) на живом Postgres.
 *
 * Сквозной путь, которого не было (`Д-52`): заявка подтверждена → карточка
 * слушателя связана с его учёткой по e-mail → слушатель видит обучение со
 * сроками у себя в кабинете. Плюс стражи безопасности привязки: чужую карточку
 * не перехватываем, учётку не-слушателя не связываем.
 */

const prisma = new PrismaClient();
const T = 'pm2-cab-int';
const SUBMITTER = `${T}-submitter`;
const REVIEWER = `${T}-reviewer`;
const STUDENT = `${T}-student`;
const OTHER_STUDENT = `${T}-other`;
const MANAGER = `${T}-manager`;
const STUDENT_EMAIL = `${T}-anna@org.test`;

let directionId = '';
let orgId = '';
let submitterSession: SessionPayload;
const studentSession = { sub: STUDENT, role: 'student' } as SessionPayload;

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: SUBMITTER, email: `${SUBMITTER}@x.test`, name: 'Податель', role: 'organization' },
      { id: REVIEWER, email: `${REVIEWER}@x.test`, name: 'Ревьюер', role: 'admin' },
      // Регистр адреса учётки отличается от адреса в заявке — связь всё равно ставится.
      { id: STUDENT, email: STUDENT_EMAIL.toUpperCase(), name: 'Анна', role: 'student' },
      { id: OTHER_STUDENT, email: `${T}-other@org.test`, name: 'Другой', role: 'student' },
      { id: MANAGER, email: `${T}-boris@org.test`, name: 'Борис', role: 'manager' },
    ],
    skipDuplicates: true,
  });
  const dir = await prisma.trainingDirection.create({
    data: { name: `${T}-Охрана труда`, sortOrder: 920 },
  });
  directionId = dir.id;
  const org = await prisma.organization.create({ data: { name: `${T}-Организация` } });
  orgId = org.id;
  submitterSession = {
    sub: SUBMITTER,
    role: 'organization',
    organizationMemberships: [{ organizationId: orgId, roleInOrg: 'admin', isActive: true }],
  } as SessionPayload;
});

afterAll(async () => {
  const users = [SUBMITTER, REVIEWER, STUDENT, OTHER_STUDENT, MANAGER];
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.certificate.deleteMany({ where: { organizationId: orgId } });
  await prisma.enrollmentRequest.deleteMany({ where: { submittedByUserId: SUBMITTER } });
  await prisma.student.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.trainingDirection.deleteMany({ where: { id: directionId } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe('кабинет слушателя: заявка → связь учётки → обучение со сроками', () => {
  let requestId = '';
  let itemId = '';

  it('подтверждение заявки связывает карточку с учёткой слушателя по e-mail (без учёта регистра)', async () => {
    const res = await submitEnrollmentRequest(prisma, submitterSession, {
      organizationId: orgId,
      items: [
        { fullName: 'Анна Слушатель', email: STUDENT_EMAIL, directionId },
        // Учётка с этим адресом есть, но она менеджерская — связывать нельзя.
        { fullName: 'Борис Менеджер', email: `${T}-boris@org.test`, directionId },
      ],
    });
    if (!res.ok) throw new Error(`submit failed: ${JSON.stringify(res)}`);
    requestId = res.request.id;

    const ap = await approveEnrollment(prisma, { id: requestId, reviewerId: REVIEWER });
    expect(ap.ok).toBe(true);

    const anna = await prisma.student.findFirstOrThrow({
      where: { organizationId: orgId, email: STUDENT_EMAIL },
      select: { userId: true },
    });
    expect(anna.userId).toBe(STUDENT);
    const boris = await prisma.student.findFirstOrThrow({
      where: { organizationId: orgId, email: `${T}-boris@org.test` },
      select: { userId: true },
    });
    expect(boris.userId).toBeNull();

    const item = await prisma.enrollmentRequestItem.findFirstOrThrow({
      where: { requestId, email: STUDENT_EMAIL },
      select: { id: true },
    });
    itemId = item.id;
  });

  it('сотрудник задаёт сроки; кривая дата и «окончание раньше начала» — отказ', async () => {
    const base = { id: requestId, itemId, reviewerId: REVIEWER };
    expect(
      await setEnrollmentItemDates(prisma, { ...base, startsOn: '01.11.2026', endsOn: null })
    ).toEqual({ ok: false, error: 'validation' });
    expect(
      await setEnrollmentItemDates(prisma, { ...base, startsOn: '2026-02-30', endsOn: null })
    ).toEqual({ ok: false, error: 'validation' });
    expect(
      await setEnrollmentItemDates(prisma, { ...base, startsOn: null, endsOn: '2026-13-01' })
    ).toEqual({ ok: false, error: 'validation' });
    expect(
      await setEnrollmentItemDates(prisma, {
        ...base,
        startsOn: '2026-11-15',
        endsOn: '2026-11-01',
      })
    ).toEqual({ ok: false, error: 'validation' });
    expect(
      await setEnrollmentItemDates(prisma, {
        id: requestId,
        itemId: 'нет-такой',
        reviewerId: REVIEWER,
        startsOn: null,
        endsOn: null,
      })
    ).toEqual({ ok: false, error: 'not_found' });

    expect(
      await setEnrollmentItemDates(prisma, {
        ...base,
        startsOn: '2026-11-01',
        endsOn: '2026-11-15',
      })
    ).toEqual({ ok: true });
    const row = await prisma.enrollmentRequestItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { startsOn: true, endsOn: true },
    });
    expect(row.startsOn?.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(row.endsOn?.toISOString().slice(0, 10)).toBe('2026-11-15');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { userId: REVIEWER, action: 'enrollment_item_dates_set', entityId: requestId },
      orderBy: { createdAt: 'desc' },
      select: { meta: true },
    });
    expect(audit.meta).toMatchObject({
      before: { itemId, startsOn: null, endsOn: null },
      after: { itemId, startsOn: '2026-11-01', endsOn: '2026-11-15' },
    });
  });

  it('пустая строка и null очищают срок; одна дата без другой допустима', async () => {
    const base = { id: requestId, itemId, reviewerId: REVIEWER };
    expect(
      await setEnrollmentItemDates(prisma, { ...base, startsOn: '2026-11-01', endsOn: null })
    ).toEqual({ ok: true });
    expect(await setEnrollmentItemDates(prisma, { ...base, startsOn: ' ', endsOn: null })).toEqual({
      ok: true,
    });
    const row = await prisma.enrollmentRequestItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { startsOn: true, endsOn: true },
    });
    expect(row).toEqual({ startsOn: null, endsOn: null });
    await setEnrollmentItemDates(prisma, { ...base, startsOn: '2026-11-01', endsOn: '2026-11-15' });
  });

  it('слушатель видит своё обучение со сроками и удостоверение — и не видит чужого', async () => {
    const anna = await prisma.student.findFirstOrThrow({
      where: { organizationId: orgId, email: STUDENT_EMAIL },
      select: { id: true },
    });
    await prisma.certificate.create({
      data: {
        studentId: anna.id,
        organizationId: orgId,
        directionId,
        number: `${T}-0001`,
        issuedAt: new Date('2026-11-16T09:00:00Z'),
        validUntil: new Date('2029-11-16T00:00:00Z'),
      },
    });

    // 16.11.2026 10:00 МСК: до 16.11.2029 — 1096 московских дней (2028 високосный).
    const r = await getStudentCabinet(prisma, studentSession, new Date('2026-11-16T07:00:00Z'));
    if (!r.ok) throw new Error('forbidden');
    expect(r.cabinet.name).toBe('Анна Слушатель');
    expect(r.cabinet.organizations).toEqual([`${T}-Организация`]);
    expect(r.cabinet.trainings).toEqual([
      {
        id: itemId,
        directionName: `${T}-Охрана труда`,
        organizationName: `${T}-Организация`,
        status: 'approved',
        statusLabel: 'Обучение назначено',
        startsOn: '2026-11-01',
        endsOn: '2026-11-15',
      },
    ]);
    expect(r.cabinet.certificates).toEqual([
      expect.objectContaining({
        number: `${T}-0001`,
        directionName: `${T}-Охрана труда`,
        validUntil: '2029-11-16',
        daysLeft: 1096,
      }),
    ]);

    // У другого слушателя карточек нет — пусто, имя из токена.
    const other = await getStudentCabinet(prisma, {
      sub: OTHER_STUDENT,
      role: 'student',
      name: 'Другой',
    } as SessionPayload);
    expect(other).toEqual({
      ok: true,
      cabinet: { name: 'Другой', organizations: [], trainings: [], certificates: [] },
    });
    const anon = await getStudentCabinet(prisma, {
      sub: OTHER_STUDENT,
      role: 'student',
    } as SessionPayload);
    expect(anon.ok && anon.cabinet.name).toBe('');
  });

  it('отклонённое обучение слушателю не показывается', async () => {
    const res = await submitEnrollmentRequest(prisma, submitterSession, {
      organizationId: orgId,
      items: [{ fullName: 'Анна Слушатель', email: STUDENT_EMAIL, directionId }],
    });
    if (!res.ok) throw new Error('submit failed');
    await approveEnrollment(prisma, { id: res.request.id, reviewerId: REVIEWER });
    await rejectEnrollment(prisma, { id: res.request.id, reviewerId: REVIEWER, reason: 'нет' });
    const r = await getStudentCabinet(prisma, studentSession);
    expect(r.ok && r.cabinet.trainings.map((t) => t.id)).toEqual([itemId]);
  });

  it('не слушатель кабинета не получает', async () => {
    expect(
      await getStudentCabinet(prisma, { sub: MANAGER, role: 'manager' } as SessionPayload)
    ).toEqual({ ok: false, error: 'forbidden' });
  });

  it('вход слушателя подхватывает свободную карточку, но не чужую', async () => {
    // Свободная карточка с адресом Другого, заведённая вручную (без заявки).
    const free = await prisma.student.create({
      data: { organizationId: orgId, name: 'Другой', email: `${T}-OTHER@org.test` },
    });
    // Карточка, уже связанная с Анной, но с тем же адресом в другой организации, — не трогаем.
    const org2 = await prisma.organization.create({ data: { name: `${T}-Организация-2` } });
    const taken = await prisma.student.create({
      data: {
        organizationId: org2.id,
        name: 'Другой',
        email: `${T}-other@org.test`,
        userId: STUDENT,
      },
    });
    try {
      expect(await linkStudentCardsToAccount(prisma, OTHER_STUDENT)).toBe(1);
      const after = await prisma.student.findMany({
        where: { id: { in: [free.id, taken.id] } },
        select: { id: true, userId: true },
        orderBy: { id: 'asc' },
      });
      expect(Object.fromEntries(after.map((s) => [s.id, s.userId]))).toEqual({
        [free.id]: OTHER_STUDENT,
        [taken.id]: STUDENT,
      });
      // Не слушатель, отключённый и несуществующий — ничего не привязывают.
      expect(await linkStudentCardsToAccount(prisma, MANAGER)).toBe(0);
      expect(await linkStudentCardsToAccount(prisma, 'нет-такого')).toBe(0);
    } finally {
      await prisma.student.deleteMany({ where: { organizationId: org2.id } });
      await prisma.organization.delete({ where: { id: org2.id } });
    }
  });
});
