import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

// PR-2: lifecycle/submit шлют best-effort уведомления — здесь глушим, чтобы
// prisma-моки без _count не сыпали warn-шум (вызовы проверяет lifecycle2/notify).
vi.mock('@/lib/services/enrollments/notify', () => ({
  notifySubmitterEnrollmentStatus: vi.fn(),
  notifyManagersEnrollmentSubmitted: vi.fn(),
}));

import {
  canAccessEnrollmentOrg,
  canReviewEnrollments,
  canSubmitEnrollments,
  submitterRoleLabel,
} from '@/lib/services/enrollments/policy';
import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import {
  approveEnrollment,
  rejectEnrollment,
  markProvisioned,
} from '@/lib/services/enrollments/lifecycle';

const s = (over: Record<string, unknown> = {}) =>
  ({ sub: 'u1', role: 'manager', ...over }) as never;

// `У-36`: направление снято с шапки — каждая позиция называет своё.
const ITEM = { fullName: 'Иван Иванов', email: 'i@x.ru', directionId: 'd1' };

beforeEach(() => {
  recordAudit.mockReset();
  recordPiiAccess.mockReset();
});

describe('enrollment policy', () => {
  it('reviewers = manager (incl leader) + admin', () => {
    expect(canReviewEnrollments(s({ role: 'manager' }))).toBe(true);
    expect(canReviewEnrollments(s({ role: 'admin' }))).toBe(true);
    expect(canReviewEnrollments(s({ role: 'partner' }))).toBe(false);
    expect(canReviewEnrollments(s({ role: 'organization' }))).toBe(false);
  });
  it('submitters: весь штат и клиенты, кроме слушателя', () => {
    for (const r of ['partner', 'organization', 'manager', 'admin'])
      expect(canSubmitEnrollments(s({ role: r }))).toBe(true);
    expect(canSubmitEnrollments(s({ role: 'student' }))).toBe(false);
  });
  it('labels leader distinctly', () => {
    expect(submitterRoleLabel(s({ role: 'leader' }))).toBe('leader');
    expect(submitterRoleLabel(s({ role: 'manager' }))).toBe('manager');
    expect(submitterRoleLabel(s({ role: 'partner' }))).toBe('partner');
  });
  it('руководитель тоже подаёт заявки (ТЗ 2026-08-17)', () => {
    expect(canSubmitEnrollments(s({ role: 'leader' }))).toBe(true);
  });
});

// Аудит A1: скоуп организации мастера заявки (был приватной функцией роута
// /api/enrollments/students, теперь предикат сервисного слоя).
describe('canAccessEnrollmentOrg', () => {
  const findFirst = vi.fn();
  const db = { organization: { findFirst } } as never;

  beforeEach(() => findFirst.mockReset());

  it('manager/admin — любая организация, без запроса в базу', async () => {
    expect(await canAccessEnrollmentOrg(db, s({ role: 'manager' }), 'o1')).toBe(true);
    expect(await canAccessEnrollmentOrg(db, s({ role: 'admin' }), 'o1')).toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('organization — только своё активное членство', async () => {
    const session = s({
      role: 'organization',
      organizationMemberships: [
        { organizationId: 'o1', isActive: true },
        { organizationId: 'o2', isActive: false },
      ],
    });
    expect(await canAccessEnrollmentOrg(db, session, 'o1')).toBe(true);
    expect(await canAccessEnrollmentOrg(db, session, 'o2')).toBe(false);
    expect(await canAccessEnrollmentOrg(db, s({ role: 'organization' }), 'o1')).toBe(false);
  });

  it('partner — запрос со своим partnerId; без partnerId — sentinel deny-all', async () => {
    findFirst.mockResolvedValue({ id: 'o1' });
    expect(await canAccessEnrollmentOrg(db, s({ role: 'partner', partnerId: 'p1' }), 'o1')).toBe(
      true
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', partnerId: 'p1' } })
    );

    findFirst.mockResolvedValue(null);
    expect(await canAccessEnrollmentOrg(db, s({ role: 'partner' }), 'o1')).toBe(false);
    expect(findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'o1', partnerId: '__none__' } })
    );
  });
});

describe('submitEnrollmentRequest (этап 2: шапка + позиции)', () => {
  function db(over: Record<string, unknown> = {}) {
    const requestCreate = vi
      .fn()
      .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'E1',
        ...data,
      }));
    const itemCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const base = {
      trainingDirection: {
        findFirst: vi.fn().mockResolvedValue({ id: 'd1' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'd1' }]),
      },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: 'o1' }) },
      student: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          enrollmentRequest: { create: requestCreate },
          enrollmentRequestItem: { createMany: itemCreateMany },
        })
      ),
      ...over,
    };
    return { d: base as never, requestCreate, itemCreateMany, base };
  }

  it('validation: нет направления / нет позиций — русские сообщения', async () => {
    const { d } = db();
    // `У-36`: направление спрашивают у КАЖДОЙ строки — шапки, где его можно
    // было указать один раз на всю заявку, больше нет.
    expect(
      await submitEnrollmentRequest(d, s({ role: 'admin' }), {
        items: [{ fullName: 'Иван Иванов', email: 'i@x.ru' }],
      })
    ).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Слушатель 1: не выбрано обучение'],
    });
    const r = await submitEnrollmentRequest(d, s({ role: 'admin' }), {
      items: [],
    });
    expect(r).toMatchObject({ ok: false, error: 'validation' });
    expect((r as { messages: string[] }).messages).toEqual(['Добавьте хотя бы одного слушателя']);
  });

  it('validation: направление позиции неактивно/не найдено', async () => {
    // `У-36`: проверка направления переехала с шапки на позиции — сервис
    // спрашивает справочник одним `findMany` по всем строкам сразу.
    const { d } = db({
      trainingDirection: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
    const r = await submitEnrollmentRequest(d, s({ role: 'admin' }), {
      items: [ITEM],
    });
    expect(r).toMatchObject({
      ok: false,
      error: 'validation',
      messages: ['Направление слушателя не найдено или неактивно'],
    });
  });

  it('шапка+позиции создаются в транзакции; snapshot submitterRole/partnerId партнёра', async () => {
    const { d, requestCreate, itemCreateMany } = db();
    const r = await submitEnrollmentRequest(d, s({ role: 'partner', partnerId: 'p1' }), {
      organizationId: 'o1',
      items: [
        {
          ...ITEM,
          position: ' инженер ',
          snils: '112-233-445 95',
          birthDate: '1990-01-02',
          extra: ' прим ',
        },
      ],
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.submitterRole).toBe('partner');
    expect(r.request.partnerId).toBe('p1');
    expect(r.itemCount).toBe(1);
    // `У-36`: шапочного направления в записи заявки больше нет — оно
    // хранится только в позициях.
    expect(requestCreate.mock.calls[0][0].data.directionId).toBeUndefined();
    const item = itemCreateMany.mock.calls[0][0].data[0];
    expect(item).toMatchObject({
      requestId: 'E1',
      fullName: 'Иван Иванов',
      email: 'i@x.ru',
      position: 'инженер',
      snils: '11223344595',
      extra: 'прим',
    });
    expect(item.birthDate).toEqual(new Date('1990-01-02T00:00:00.000Z'));
  });

  it('blocks a partner targeting an org outside its scope', async () => {
    const { d } = db({ organization: { findFirst: vi.fn().mockResolvedValue(null) } });
    const r = await submitEnrollmentRequest(d, s({ role: 'partner', partnerId: 'p1' }), {
      organizationId: 'oX',
      items: [ITEM],
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('forbids a role that cannot submit (student)', async () => {
    const { d } = db();
    const r = await submitEnrollmentRequest(d, s({ role: 'student' }), {
      items: [ITEM],
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('studentId: чужой/несуществующий сотрудник → forbidden (IDOR)', async () => {
    const { d } = db(); // student.findMany → []
    const r = await submitEnrollmentRequest(
      d,
      s({
        role: 'organization',
        organizationId: 'o1',
        organizationMemberships: [{ organizationId: 'o1', isActive: true }],
      }),
      {
        items: [{ studentId: 'stX', directionId: 'd1' }],
      }
    );
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('studentId без организации (admin, org не выбрана) → forbidden', async () => {
    const { d } = db();
    const r = await submitEnrollmentRequest(d, s({ role: 'admin' }), {
      items: [{ studentId: 'st1', directionId: 'd1' }],
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('studentId своей организации: ФИО/email снимаются со Student', async () => {
    const { d, itemCreateMany } = db({
      student: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'st1', name: 'Пётр Петров', email: 'p@org.ru' }]),
      },
    });
    const session = s({
      role: 'organization',
      organizationId: 'o1',
      organizationMemberships: [{ organizationId: 'o1', isActive: true }],
    });
    const r = await submitEnrollmentRequest(d, session, {
      items: [{ studentId: 'st1', directionId: 'd1' }],
    });
    if (!r.ok) throw new Error('expected ok');
    expect(itemCreateMany.mock.calls[0][0].data[0]).toMatchObject({
      studentId: 'st1',
      fullName: 'Пётр Петров',
      email: 'p@org.ru',
    });
  });

  it('дубликаты склеиваются с warning; аудит без ПДн (только счётчики)', async () => {
    const { d, itemCreateMany } = db();
    const r = await submitEnrollmentRequest(d, s({ role: 'admin' }), {
      // У-36: дубль обязан назвать то же обучение — иначе это разные строки.
      items: [ITEM, { fullName: 'Дубль', email: 'I@X.RU', directionId: 'd1' }],
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.itemCount).toBe(1);
    expect(r.warnings).toHaveLength(1);
    expect(itemCreateMany.mock.calls[0][0].data).toHaveLength(1);
    const audit = recordAudit.mock.calls[0][1];
    expect(audit.after).toEqual({
      organizationId: null,
      // У-36: вместо снятого шапочного поля в журнал идут направления позиций.
      directionIds: ['d1'],
      itemCount: 1,
      submitterRole: 'admin',
    });
    expect(JSON.stringify(audit.after)).not.toContain('i@x.ru');
  });
});

describe('listEnrollmentRequests scope', () => {
  function db(rows: unknown[] = []) {
    const findMany = vi.fn().mockResolvedValue(rows);
    return { db: { enrollmentRequest: { findMany } } as never, findMany };
  }
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    submittedByUser: { name: 'U' },
    direction: { name: 'Охрана труда' },
    legacyCourseTitle: null,
    items: [],
    ...over,
  });

  it('reviewer sees the whole queue (empty scope)', async () => {
    const { db: d, findMany } = db();
    await listEnrollmentRequests(d, s({ role: 'manager' }));
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({});
  });
  it('partner scoped by partnerId', async () => {
    const { db: d, findMany } = db();
    await listEnrollmentRequests(d, s({ role: 'partner', partnerId: 'p1' }));
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({ partnerId: 'p1' });
  });
  it('направление: имя из справочника, для legacy — сохранённый текст, иначе «—»', async () => {
    const rows = [
      row('R1', {
        items: [
          // PR-3 «замок»: направление у позиции обязательно — связь непустая.
          { id: 'i1', fullName: 'Иван', direction: { name: 'Охрана труда' } },
          { id: 'i2', fullName: 'Пётр', direction: { name: 'Работы на высоте' } },
        ],
      }),
      row('R2', { direction: null, legacyCourseTitle: 'Старый курс' }),
      row('R3', { direction: null }),
    ];
    const { db: d } = db(rows);
    const res = await listEnrollmentRequests(d, s({ role: 'manager' }), {});
    expect(res.rows[0]).toMatchObject({
      directionName: 'Охрана труда',
      studentCount: 2,
      firstStudentName: 'Иван',
    });
    expect(res.rows[1]!.directionName).toBe('Старый курс');
    expect(res.rows[2]).toMatchObject({
      directionName: '—',
      studentCount: 0,
      firstStudentName: null,
    });
  });
  it('поиск — по позициям и направлению', async () => {
    const { db: d, findMany } = db();
    await listEnrollmentRequests(d, s({ role: 'manager' }), { search: 'иван' });
    const or = findMany.mock.calls[0][0].where.AND[1].OR;
    expect(or).toEqual([
      // У-36: направление живёт в позициях — поиск ищет там.
      { items: { some: { direction: { name: { contains: 'иван', mode: 'insensitive' } } } } },
      { legacyCourseTitle: { contains: 'иван', mode: 'insensitive' } },
      { items: { some: { fullName: { contains: 'иван', mode: 'insensitive' } } } },
      { items: { some: { email: { contains: 'иван', mode: 'insensitive' } } } },
    ]);
  });
  it('PII: журналирует состав выдачи для staff-вызова', async () => {
    const rows = [row('R1'), row('R2')];
    const { db: d } = db(rows);
    await listEnrollmentRequests(d, s({ role: 'manager' }), {});
    expect(recordPiiAccess).toHaveBeenCalledWith(
      d,
      expect.objectContaining({
        context: 'enrollments_list',
        subjectIds: ['R1', 'R2'],
      })
    );
  });
});

describe('enrollment lifecycle (шапка + зеркалирование позиций)', () => {
  function db(status: string, itemCount = 1) {
    const requestUpdate = vi
      .fn()
      .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'E1',
        ...data,
      }));
    const itemUpdateMany = vi.fn().mockResolvedValue({ count: itemCount });
    const base = {
      enrollmentRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'E1', status }) },
      enrollmentRequestItem: { count: vi.fn().mockResolvedValue(itemCount) },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          enrollmentRequest: { update: requestUpdate },
          enrollmentRequestItem: { updateMany: itemUpdateMany },
        })
      ),
    };
    return { d: base as never, requestUpdate, itemUpdateMany };
  }

  it('approve: pending → approved, pending-позиции зеркалируются', async () => {
    const { d, itemUpdateMany } = db('pending');
    const r = await approveEnrollment(d, { id: 'E1', reviewerId: 'm1' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.status).toBe('approved');
    expect(itemUpdateMany).toHaveBeenCalledWith({
      where: { requestId: 'E1', status: 'pending' },
      data: { status: 'approved' },
    });
  });
  it('approve forbidden from non-pending', async () => {
    const { d } = db('approved');
    expect(await approveEnrollment(d, { id: 'E1', reviewerId: 'm1' })).toEqual({
      ok: false,
      error: 'lifecycle_violation',
    });
  });
  it('markProvisioned: для одиночной заявки id из LMS обязателен и пишется в позицию', async () => {
    expect(
      await markProvisioned(db('approved').d, { id: 'E1', reviewerId: 'm1', externalStudentId: '' })
    ).toEqual({ ok: false, error: 'validation' });
    expect(
      await markProvisioned(db('pending').d, {
        id: 'E1',
        reviewerId: 'm1',
        externalStudentId: 'LMS-9',
      })
    ).toEqual({ ok: false, error: 'lifecycle_violation' });
    const { d, itemUpdateMany } = db('approved');
    const r = await markProvisioned(d, { id: 'E1', reviewerId: 'm1', externalStudentId: 'LMS-9' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.status).toBe('provisioned');
    expect(itemUpdateMany).toHaveBeenCalledWith({
      where: { requestId: 'E1', status: { not: 'rejected' } },
      data: { status: 'provisioned', externalStudentId: 'LMS-9' },
    });
  });
  it('markProvisioned: многопозиционная — без общего id, позиции provisioned', async () => {
    const { d, itemUpdateMany } = db('approved', 3);
    const r = await markProvisioned(d, { id: 'E1', reviewerId: 'm1' });
    if (!r.ok) throw new Error('expected ok');
    expect(itemUpdateMany).toHaveBeenCalledWith({
      where: { requestId: 'E1', status: { not: 'rejected' } },
      data: { status: 'provisioned' },
    });
  });
  it('reject sets reason и зеркалирует все позиции; cannot reject a provisioned request', async () => {
    const { d, itemUpdateMany } = db('pending');
    const r = await rejectEnrollment(d, { id: 'E1', reviewerId: 'm1', reason: 'нет мест' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.status).toBe('rejected');
    expect(itemUpdateMany).toHaveBeenCalledWith({
      where: { requestId: 'E1' },
      data: { status: 'rejected' },
    });
    expect(
      await rejectEnrollment(db('provisioned').d, { id: 'E1', reviewerId: 'm1', reason: 'x' })
    ).toEqual({ ok: false, error: 'lifecycle_violation' });
  });
  it('not_found на отсутствующей заявке', async () => {
    const base = db('pending');
    (
      base.d as { enrollmentRequest: { findUnique: ReturnType<typeof vi.fn> } }
    ).enrollmentRequest.findUnique = vi.fn().mockResolvedValue(null);
    expect(await approveEnrollment(base.d, { id: 'EX', reviewerId: 'm1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await rejectEnrollment(base.d, { id: 'EX', reviewerId: 'm1', reason: 'x' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await markProvisioned(base.d, { id: 'EX', reviewerId: 'm1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
