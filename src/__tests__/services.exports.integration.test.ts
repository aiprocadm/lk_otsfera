/**
 * Этап 9 PR-3 (ФТ-12.1/12.2) integration против реальной схемы:
 *  - счётчик действующих удостоверений в выгрузке сотрудников (границы статуса);
 *  - должность: правка из карточки + автоподхват из заявки на обучение
 *    (не затирая уже заполненную);
 *  - журнал ПДн: staff-выгрузка пишет событие с action='export', клиентская —
 *    не пишет (isStaff-фильтр).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  listOrgStudentsForExport,
  updateOrgStudentPosition,
} from '@/lib/services/organization/students';
import { listOrgPaymentsForExport } from '@/lib/services/organization/finance';
import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import { recordPiiAccess } from '@/lib/pii/record';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const RUN = `exp-int-${process.pid}`;

let companyId: string;
let orgId: string;
let otherOrgId: string;
let directionId: string;
let actorId: string;
let sWithCerts: string;
let sExpired: string;
let sForeign: string;

const NOW = new Date('2026-06-15T12:00:00Z');

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `${RUN}-co` } });
  companyId = company.id;

  const org = await prisma.organization.create({
    data: { name: `${RUN}-org`, companyId },
  });
  orgId = org.id;
  const other = await prisma.organization.create({
    data: { name: `${RUN}-org2`, companyId },
  });
  otherOrgId = other.id;

  const direction = await prisma.trainingDirection.create({
    data: { name: `${RUN}-dir`, isActive: true },
  });
  directionId = direction.id;

  const actor = await prisma.user.create({
    data: {
      email: `${RUN}-actor@test.local`,
      name: `${RUN} actor`,
      role: 'organization',
      passwordHash: 'x',
    },
  });
  actorId = actor.id;

  const a = await prisma.student.create({
    data: { name: `${RUN} Первый`, email: `${RUN}-a@test.local`, organizationId: orgId },
  });
  sWithCerts = a.id;
  const b = await prisma.student.create({
    data: { name: `${RUN} Второй`, email: `${RUN}-b@test.local`, organizationId: orgId },
  });
  sExpired = b.id;
  const c = await prisma.student.create({
    data: { name: `${RUN} Чужой`, email: `${RUN}-c@test.local`, organizationId: otherOrgId },
  });
  sForeign = c.id;

  // Первому: бессрочное + действующее + истёкшее; второму — только истёкшее.
  await prisma.certificate.createMany({
    data: [
      {
        number: `${RUN}-1`,
        studentId: sWithCerts,
        organizationId: orgId,
        directionId,
        issuedAt: new Date('2026-01-01'),
        validUntil: null,
      },
      {
        number: `${RUN}-2`,
        studentId: sWithCerts,
        organizationId: orgId,
        directionId,
        issuedAt: new Date('2026-01-01'),
        validUntil: new Date('2026-12-31'),
      },
      {
        number: `${RUN}-3`,
        studentId: sWithCerts,
        organizationId: orgId,
        directionId,
        issuedAt: new Date('2025-01-01'),
        validUntil: new Date('2026-01-31'),
      },
      {
        number: `${RUN}-4`,
        studentId: sExpired,
        organizationId: orgId,
        directionId,
        issuedAt: new Date('2025-01-01'),
        validUntil: new Date('2026-01-31'),
      },
    ],
  });
});

afterAll(async () => {
  await prisma.piiAccessEvent.deleteMany({ where: { userId: actorId } });
  await prisma.enrollmentRequestItem.deleteMany({
    where: { request: { organizationId: { in: [orgId, otherOrgId] } } },
  });
  await prisma.enrollmentRequest.deleteMany({
    where: { organizationId: { in: [orgId, otherOrgId] } },
  });
  await prisma.certificate.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.student.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  // подача заявки пишет аудит — снимаем ссылку на пользователя перед удалением
  await prisma.auditLog.deleteMany({ where: { userId: actorId } });
  await prisma.user.delete({ where: { id: actorId } });
  await prisma.trainingDirection.delete({ where: { id: directionId } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('listOrgStudentsForExport (integration)', () => {
  it('считает только действующие удостоверения и не выходит за организацию', async () => {
    const res = await listOrgStudentsForExport(prisma, {
      organizationId: orgId,
      limit: 100,
      now: NOW,
    });

    const byId = new Map(res.rows.map((r) => [r.id, r]));
    expect(res.total).toBe(2);
    expect(byId.get(sWithCerts)!.activeCertificates).toBe(2); // бессрочное + не истёкшее
    expect(byId.get(sExpired)!.activeCertificates).toBe(0); // только истёкшее
    expect(byId.has(sForeign)).toBe(false);
  });

  it('уважает поиск экрана', async () => {
    const res = await listOrgStudentsForExport(prisma, {
      organizationId: orgId,
      search: 'Первый',
      limit: 100,
      now: NOW,
    });
    expect(res.rows.map((r) => r.id)).toEqual([sWithCerts]);
    expect(res.total).toBe(1);
  });
});

describe('updateOrgStudentPosition (integration)', () => {
  it('сохраняет и очищает должность; чужой сотрудник — forbidden', async () => {
    const saved = await updateOrgStudentPosition(prisma, {
      organizationId: orgId,
      studentId: sWithCerts,
      position: 'Инженер по охране труда',
    });
    expect(saved).toEqual({ ok: true, position: 'Инженер по охране труда' });
    expect((await prisma.student.findUnique({ where: { id: sWithCerts } }))!.position).toBe(
      'Инженер по охране труда'
    );

    const foreign = await updateOrgStudentPosition(prisma, {
      organizationId: orgId,
      studentId: sForeign,
      position: 'Директор',
    });
    expect(foreign).toEqual({ ok: false, error: 'forbidden' });
    expect((await prisma.student.findUnique({ where: { id: sForeign } }))!.position).toBeNull();
  });
});

describe('должность из заявки на обучение (integration)', () => {
  const session = (): SessionPayload =>
    ({
      sub: actorId,
      role: 'organization',
      email: `${RUN}-actor@test.local`,
      companyId,
      organizationMemberships: [{ organizationId: orgId, isActive: true, roleInOrg: 'admin' }],
    }) as unknown as SessionPayload;

  it('подхватывается для пустой должности и НЕ затирает заполненную', async () => {
    // sWithCerts уже с должностью из предыдущего блока, sExpired — пустой
    const res = await submitEnrollmentRequest(prisma, session(), {
      organizationId: orgId,
      items: [
        { studentId: sWithCerts, position: 'Слесарь', directionId },
        { studentId: sExpired, position: 'Электромонтёр', directionId },
      ],
    });
    expect(res.ok).toBe(true);

    const [kept, filled] = await Promise.all([
      prisma.student.findUnique({ where: { id: sWithCerts } }),
      prisma.student.findUnique({ where: { id: sExpired } }),
    ]);
    expect(kept!.position).toBe('Инженер по охране труда'); // не затёрли
    expect(filled!.position).toBe('Электромонтёр'); // подхватили
  });
});

describe('журнал ПДн для выгрузок (integration)', () => {
  const staffSession = (): SessionPayload =>
    ({ sub: actorId, role: 'manager', companyId }) as unknown as SessionPayload;
  const clientSession = (): SessionPayload =>
    ({ sub: actorId, role: 'organization', companyId }) as unknown as SessionPayload;

  it('staff-выгрузка пишет событие с action=export; клиентская — не пишет', async () => {
    process.env.FEATURE_PII_ACCESS_LOG = '1';
    try {
      await recordPiiAccess(prisma, {
        session: staffSession(),
        context: 'org_card_certificates_export',
        subjectIds: [sWithCerts],
        meta: { take: 1, hasQuery: false },
      });
      await recordPiiAccess(prisma, {
        session: clientSession(),
        context: 'org_card_certificates_export',
        subjectIds: [sWithCerts],
      });

      const rows = await prisma.piiAccessEvent.findMany({ where: { userId: actorId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe('export');
      expect(rows[0]!.subjectType).toBe('student');
      expect(rows[0]!.userRole).toBe('manager');
      expect(rows[0]!.subjectIds).toEqual([sWithCerts]);
    } finally {
      process.env.FEATURE_PII_ACCESS_LOG = '0';
    }
  });
});

describe('listOrgPaymentsForExport (integration)', () => {
  it('организация без платежей — пустой леджер и нулевой total', async () => {
    const res = await listOrgPaymentsForExport(prisma, { organizationId: orgId, limit: 100 });
    expect(res).toEqual({ rows: [], total: 0 });
  });
});
