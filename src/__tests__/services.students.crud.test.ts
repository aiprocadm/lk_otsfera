import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Справочник сотрудников: права, поиск дублей и запись (`У-22`, `У-23`,
 * `У-32`, этап 5).
 *
 * Три файла сервиса отгрузили без собственных тестов — долг гейта покрытия.
 * Проверяем не «функция вызвалась», а инварианты, ради которых сервис написан:
 * запрет живёт в сервисе, а не в кнопке (§4); дубль **сообщается, а не
 * запрещается** (решение заказчика); ПДн не попадают в журнал аудита (§12);
 * сотрудник деактивируется, а не удаляется, иначе осиротеет история обучения.
 */
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { studentOrgAccess } from '@/lib/services/students/access';
import { findDuplicates, normalizeSnils } from '@/lib/services/students/duplicates';
import { createStudent, updateStudent, deactivateStudent } from '@/lib/services/students/crud';

const ORG = 'org-1';

function db(over: Record<string, unknown> = {}) {
  return {
    organization: { findFirst: vi.fn().mockResolvedValue(null) },
    student: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 's-new', name: 'Иванов Иван' }),
      update: vi.fn().mockResolvedValue({}),
    },
    ...over,
  } as unknown as PrismaClient;
}

const session = (over: Partial<SessionPayload>): SessionPayload =>
  ({ sub: 'u1', ...over }) as unknown as SessionPayload;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('studentOrgAccess (У-32) — кто и что может', () => {
  it('админ читает и пишет везде, не заглядывая в базу', async () => {
    const prisma = db();
    await expect(studentOrgAccess(prisma, session({ role: 'admin' }), ORG, false)).resolves.toEqual(
      {
        canRead: true,
        canWrite: true,
      }
    );
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
  });

  it('сотрудник заказчика: рядовой только читает, админ и руководитель пишут', async () => {
    const withRole = (roleInOrg: string) =>
      session({
        role: 'organization',
        organizationMemberships: [{ organizationId: ORG, roleInOrg, isActive: true }],
      } as Partial<SessionPayload>);

    await expect(studentOrgAccess(db(), withRole('member'), ORG, false)).resolves.toEqual({
      canRead: true,
      canWrite: false,
    });
    for (const role of ['admin', 'leader']) {
      await expect(studentOrgAccess(db(), withRole(role), ORG, false)).resolves.toEqual({
        canRead: true,
        canWrite: true,
      });
    }
  });

  it('погашенное членство прав не даёт — и чужая организация тоже', async () => {
    const inactive = session({
      role: 'organization',
      organizationMemberships: [{ organizationId: ORG, roleInOrg: 'admin', isActive: false }],
    } as Partial<SessionPayload>);
    await expect(studentOrgAccess(db(), inactive, ORG, false)).resolves.toEqual({
      canRead: false,
      canWrite: false,
    });

    const other = session({
      role: 'organization',
      organizationMemberships: [{ organizationId: 'org-9', roleInOrg: 'admin', isActive: true }],
    } as Partial<SessionPayload>);
    await expect(studentOrgAccess(db(), other, ORG, false)).resolves.toEqual({
      canRead: false,
      canWrite: false,
    });
  });

  it('роль без членств вовсе не падает, а отказывает', async () => {
    await expect(
      studentOrgAccess(db(), session({ role: 'organization' }), ORG, false)
    ).resolves.toEqual({ canRead: false, canWrite: false });
  });

  it('партнёрская принадлежность проверяется по базе, а не по токену', async () => {
    // Список организаций в токене устаревает, привязка к партнёру — нет.
    const prisma = db({
      organization: { findFirst: vi.fn().mockResolvedValue({ id: ORG }) },
    });
    const partner = session({ role: 'partner', partnerId: 'p1' });

    await expect(studentOrgAccess(prisma, partner, ORG, false)).resolves.toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({
      where: { id: ORG, partnerId: 'p1' },
      select: { id: true },
    });
  });

  it('партнёр без partnerId и чужая организация — отказ', async () => {
    await expect(studentOrgAccess(db(), session({ role: 'partner' }), ORG, false)).resolves.toEqual(
      { canRead: false, canWrite: false }
    );

    // findFirst вернул null — организация не в портфеле.
    await expect(
      studentOrgAccess(db(), session({ role: 'partner', partnerId: 'p1' }), ORG, false)
    ).resolves.toEqual({ canRead: false, canWrite: false });
  });

  it('у партнёрского пользователя с назначенными организациями скоуп сужается', async () => {
    const prisma = db({ organization: { findFirst: vi.fn().mockResolvedValue({ id: ORG }) } });
    const assigned = (ids: string[]) =>
      session({ role: 'partner', partnerId: 'p1', assignedOrgIds: ids } as Partial<SessionPayload>);

    await expect(studentOrgAccess(prisma, assigned(['org-9']), ORG, false)).resolves.toEqual({
      canRead: false,
      canWrite: false,
    });
    // Пустой список — «ограничений нет», а не «ничего нельзя».
    await expect(studentOrgAccess(prisma, assigned([]), ORG, false)).resolves.toEqual({
      canRead: true,
      canWrite: true,
    });
  });

  it('менеджеру граница считается своим скоупом и зависит от режима команды', async () => {
    const prisma = db({ organization: { findFirst: vi.fn().mockResolvedValue({ id: ORG }) } });
    const manager = session({ role: 'manager', sub: 'm1', companyId: 'c1' });

    await expect(studentOrgAccess(prisma, manager, ORG, true)).resolves.toEqual({
      canRead: true,
      canWrite: true,
    });
    const whereTeam = (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(whereTeam.where.AND[0]).toEqual({ id: ORG });

    // Тот же вызов с teamMode=false даёт ДРУГОЕ условие — режим реально доходит
    // до запроса, а не теряется по дороге.
    await studentOrgAccess(prisma, manager, ORG, false);
    const wherePersonal = (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mock
      .calls[1][0];
    expect(JSON.stringify(wherePersonal)).not.toBe(JSON.stringify(whereTeam));
  });

  it('менеджер вне скоупа получает отказ', async () => {
    await expect(
      studentOrgAccess(db(), session({ role: 'manager', companyId: 'c1' }), ORG, true)
    ).resolves.toEqual({ canRead: false, canWrite: false });
  });

  it('слушателю справочник недоступен вовсе', async () => {
    await expect(studentOrgAccess(db(), session({ role: 'student' }), ORG, false)).resolves.toEqual(
      {
        canRead: false,
        canWrite: false,
      }
    );
  });
});

describe('normalizeSnils — сравнение по цифрам', () => {
  it('разделители не мешают: «112-233-445 95» и «11223344595» — одно и то же', () => {
    expect(normalizeSnils('112-233-445 95')).toBe('11223344595');
    expect(normalizeSnils('11223344595')).toBe('11223344595');
  });

  it('пусто и «мусор без цифр» дают null, а не пустую строку', () => {
    expect(normalizeSnils(null)).toBeNull();
    expect(normalizeSnils(undefined)).toBeNull();
    expect(normalizeSnils('')).toBeNull();
    expect(normalizeSnils('—')).toBeNull();
  });
});

describe('findDuplicates (У-22) — порядок ключей задан ТЗ', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    name: 'Иванов Иван',
    snils: '112-233-445 95',
    birthDate: null,
    email: null,
    position: null,
    status: 'active',
    ...over,
  });

  it('СНИЛС — самый надёжный признак, ищется первым', async () => {
    const prisma = db({ student: { findMany: vi.fn().mockResolvedValue([row()]) } });
    const res = await findDuplicates(prisma, {
      organizationId: ORG,
      name: 'Иванов Иван',
      snils: '11223344595',
    });
    expect(res?.match).toBe('snils');
    expect(res?.candidates).toHaveLength(1);
  });

  it('СНИЛС сравнивается нормализованно — чужой номер не считается совпадением', async () => {
    const prisma = db({
      student: { findMany: vi.fn().mockResolvedValue([row({ snils: '999' })]) },
    });
    const res = await findDuplicates(prisma, {
      organizationId: ORG,
      name: 'Иванов Иван',
      snils: '11223344595',
    });
    expect(res).toBeNull();
  });

  it('без СНИЛС ищет по ФИО и дате рождения', async () => {
    const birthDate = new Date('1990-01-01');
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([row({ birthDate })])
      .mockResolvedValue([]);
    const prisma = db({ student: { findMany } });

    const res = await findDuplicates(prisma, {
      organizationId: ORG,
      name: '  Иванов Иван  ',
      birthDate,
    });
    expect(res?.match).toBe('name_birthdate');
    // Имя обрезается по краям — «Иванов Иван » не должно давать промах.
    expect(findMany.mock.calls[0][0].where.name).toBe('Иванов Иван');
  });

  it('последний ключ — ФИО и почта', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([row({ email: 'i@e.ru' })]);
    const prisma = db({ student: { findMany } });
    const res = await findDuplicates(prisma, {
      organizationId: ORG,
      name: 'Иванов Иван',
      email: 'i@e.ru',
    });
    expect(res?.match).toBe('name_email');
  });

  it('совпадений нет — возвращает null, а не пустую находку', async () => {
    await expect(
      findDuplicates(db(), { organizationId: ORG, name: 'Иванов Иван', email: 'i@e.ru' })
    ).resolves.toBeNull();
  });

  it('при редактировании сотрудник не дубль сам себе', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = db({ student: { findMany } });
    await findDuplicates(prisma, {
      organizationId: ORG,
      name: 'Иванов Иван',
      email: 'i@e.ru',
      excludeId: 's1',
    });
    expect(findMany.mock.calls[0][0].where.id).toEqual({ not: 's1' });
  });
});

describe('createStudent (У-23)', () => {
  const admin = session({ role: 'admin' });
  const args = { organizationId: ORG, teamMode: false, name: 'Иванов Иван' };

  it('без права записи ничего не пишет', async () => {
    const prisma = db();
    const res = await createStudent(prisma, session({ role: 'student' }), args);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(prisma.student.create).not.toHaveBeenCalled();
  });

  it('ФИО обязательна, остальное — нет', async () => {
    const res = await createStudent(db(), admin, { ...args, name: '   ' });
    expect(res).toEqual({ ok: false, error: 'validation', messages: ['Укажите ФИО сотрудника'] });
  });

  it('кривые СНИЛС и почта названы по-русски, обе ошибки сразу', async () => {
    const res = await createStudent(db(), admin, { ...args, snils: '123', email: 'нет-собаки' });
    expect(res).toMatchObject({
      ok: false,
      error: 'validation',
      messages: ['СНИЛС должен содержать 11 цифр', 'Почта указана неверно'],
    });
  });

  it('найденный дубль ОСТАНАВЛИВАЕТ запись и показывает, на кого похоже', async () => {
    const candidate = {
      id: 's1',
      name: 'Иванов Иван',
      snils: '11223344595',
      birthDate: null,
      email: null,
      position: null,
      status: 'active',
    };
    const prisma = db({
      student: { ...db().student, findMany: vi.fn().mockResolvedValue([candidate]) },
    });
    const res = await createStudent(prisma, admin, { ...args, snils: '11223344595' });

    expect(res).toMatchObject({ ok: false, error: 'duplicate_found', match: 'snils' });
    expect(prisma.student.create).not.toHaveBeenCalled();
  });

  it('«Всё равно добавить» пишет, не проверяя дубли — однофамильцы существуют', async () => {
    const findMany = vi.fn();
    const prisma = db({ student: { ...db().student, findMany } });
    const res = await createStudent(prisma, admin, { ...args, force: true });

    expect(res).toEqual({ ok: true, id: 's-new' });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('пустые поля сохраняются как «не указано», а не пустыми строками', async () => {
    const prisma = db();
    await createStudent(prisma, admin, {
      ...args,
      position: '  ',
      snils: '',
      email: null,
      phone: '  ',
      note: '',
    });
    expect((prisma.student.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toMatchObject(
      {
        name: 'Иванов Иван',
        position: null,
        snils: null,
        birthDate: null,
        email: null,
        phone: null,
        note: null,
        organizationId: ORG,
      }
    );
  });

  it('в журнал аудита не уходят ни СНИЛС, ни дата рождения', async () => {
    await createStudent(db(), admin, {
      ...args,
      force: true,
      snils: '11223344595',
      birthDate: new Date('1990-01-01'),
    });
    const entry = recordAudit.mock.calls[0][1];
    expect(entry).toMatchObject({
      action: 'student_created',
      entity: 'student',
      entityId: 's-new',
    });
    expect(JSON.stringify(entry.after)).not.toContain('11223344595');
    expect(entry.after).toEqual({ name: 'Иванов Иван', organizationId: ORG });
  });
});

describe('updateStudent (У-23)', () => {
  const admin = session({ role: 'admin' });
  const existing = { id: 's1', organizationId: ORG, name: 'Иванов Иван' };

  it('несуществующего сотрудника не правим', async () => {
    const res = await updateStudent(db(), admin, { id: 's1', teamMode: false, name: 'Новое имя' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('право проверяется по организации найденного сотрудника, а не по переданной', async () => {
    // Иначе можно было бы «переписать» чужого, подставив свою организацию.
    const prisma = db({
      student: { ...db().student, findUnique: vi.fn().mockResolvedValue(existing) },
    });
    const res = await updateStudent(prisma, session({ role: 'student' }), {
      id: 's1',
      teamMode: false,
      name: 'Новое имя',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(prisma.student.update).not.toHaveBeenCalled();
  });

  it('проверки те же, что при создании', async () => {
    const prisma = db({
      student: { ...db().student, findUnique: vi.fn().mockResolvedValue(existing) },
    });
    const res = await updateStudent(prisma, admin, { id: 's1', teamMode: false, name: '' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });

  it('в аудит попадает старое и новое имя', async () => {
    const prisma = db({
      student: { ...db().student, findUnique: vi.fn().mockResolvedValue(existing) },
    });
    await updateStudent(prisma, admin, { id: 's1', teamMode: false, name: 'Петров Пётр' });

    expect(recordAudit.mock.calls[0][1]).toMatchObject({
      action: 'student_updated',
      before: { name: 'Иванов Иван' },
      after: { name: 'Петров Пётр' },
    });
  });

  it('пустое имя при валидном вводе не затирает старое в аудите', async () => {
    // clean() вернёт null только если имя из пробелов — но такое не проходит
    // валидацию. Ветка нужна как страховка: журнал не должен показать «null».
    const prisma = db({
      student: { ...db().student, findUnique: vi.fn().mockResolvedValue(existing) },
    });
    await updateStudent(prisma, admin, { id: 's1', teamMode: false, name: 'Иванов Иван' });
    expect(recordAudit.mock.calls[0][1].after).toEqual({ name: 'Иванов Иван' });
  });
});

describe('deactivateStudent (У-23) — не удаляем, а гасим', () => {
  const admin = session({ role: 'admin' });
  const existing = { id: 's1', organizationId: ORG, status: 'active', name: 'Иванов Иван' };

  it('несуществующего не гасим', async () => {
    const res = await deactivateStudent(db(), admin, { id: 's1', teamMode: false });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('без права записи отказ', async () => {
    const prisma = db({
      student: { ...db().student, findUnique: vi.fn().mockResolvedValue(existing) },
    });
    const res = await deactivateStudent(prisma, session({ role: 'student' }), {
      id: 's1',
      teamMode: false,
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(prisma.student.update).not.toHaveBeenCalled();
  });

  it('запись остаётся в базе — иначе осиротеют удостоверения и заявки', async () => {
    const prisma = db({
      student: { ...db().student, findUnique: vi.fn().mockResolvedValue(existing) },
    });
    const res = await deactivateStudent(prisma, admin, { id: 's1', teamMode: false });

    expect(res).toEqual({ ok: true });
    expect(prisma.student.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'inactive' },
    });
    expect(recordAudit.mock.calls[0][1]).toMatchObject({
      action: 'student_deactivated',
      before: { status: 'active' },
      after: { status: 'inactive' },
    });
  });
});
