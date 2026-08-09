/**
 * Справочник сотрудников (`У-22`, `У-23`, `У-32`, этап 5 ТЗ понятности).
 *
 * Главный страж этапа: **права проверяет сервис, а не кнопка** (CLAUDE.md §4).
 * Каждая отказная ветка проверяет два факта — код ответа **и** отсутствие
 * записи в базу; одного кода мало (та же дисциплина, что у `У-4`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import { createStudent, deactivateStudent, updateStudent } from '@/lib/services/students/crud';
import { findDuplicates, normalizeSnils } from '@/lib/services/students/duplicates';

const ORG = 'org-1';

const orgUser = (roleInOrg: string): SessionPayload =>
  ({
    sub: 'ou1',
    role: 'organization',
    organizationMemberships: [{ organizationId: ORG, roleInOrg, isActive: true }],
  }) as unknown as SessionPayload;

const partner = (partnerRole: 'admin' | 'manager' = 'admin'): SessionPayload =>
  ({ sub: 'pu1', role: 'partner', partnerId: 'pt-1', partnerRole }) as unknown as SessionPayload;

const admin = (): SessionPayload => ({ sub: 'a1', role: 'admin' }) as unknown as SessionPayload;

function makePrisma(opts: { orgFound?: boolean; existing?: unknown } = {}) {
  const create = vi.fn().mockResolvedValue({ id: 'st-1', name: 'Иванов Иван' });
  const update = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue([]);
  return {
    prisma: {
      organization: {
        findFirst: vi.fn().mockResolvedValue(opts.orgFound === false ? null : { id: ORG }),
      },
      student: {
        create,
        update,
        findMany,
        findUnique: vi.fn().mockResolvedValue(opts.existing ?? null),
      },
    } as unknown as PrismaClient,
    create,
    update,
    findMany,
  };
}

const INPUT = { name: 'Иванов Иван', teamMode: false, organizationId: ORG };

beforeEach(() => recordAuditMock.mockReset());

describe('У-32: кто может заводить сотрудников', () => {
  it('администратор организации — может', async () => {
    const { prisma, create } = makePrisma();
    const res = await createStudent(prisma, orgUser('admin'), INPUT);
    expect(res.ok).toBe(true);
    expect(create).toHaveBeenCalled();
  });

  it('руководитель организации — может', async () => {
    const { prisma } = makePrisma();
    expect((await createStudent(prisma, orgUser('leader'), INPUT)).ok).toBe(true);
  });

  it('рядовой участник организации — НЕ может и ничего не пишет', async () => {
    const { prisma, create } = makePrisma();
    const res = await createStudent(prisma, orgUser('member'), INPUT);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(create).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('пользователь чужой организации — НЕ может', async () => {
    const { prisma, create } = makePrisma();
    const stranger = {
      sub: 'x',
      role: 'organization',
      organizationMemberships: [
        { organizationId: 'org-other', roleInOrg: 'admin', isActive: true },
      ],
    } as unknown as SessionPayload;

    expect(await createStudent(prisma, stranger, INPUT)).toEqual({ ok: false, error: 'forbidden' });
    expect(create).not.toHaveBeenCalled();
  });

  it('партнёр своей организации — может (У-25)', async () => {
    const { prisma } = makePrisma({ orgFound: true });
    expect((await createStudent(prisma, partner('manager'), INPUT)).ok).toBe(true);
  });

  it('партнёр чужой организации — НЕ может и ничего не пишет', async () => {
    const { prisma, create } = makePrisma({ orgFound: false });
    expect(await createStudent(prisma, partner(), INPUT)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('администратор системы — может везде', async () => {
    const { prisma } = makePrisma();
    expect((await createStudent(prisma, admin(), INPUT)).ok).toBe(true);
  });

  it('слушатель — не может', async () => {
    const { prisma, create } = makePrisma();
    const student = { sub: 's1', role: 'student' } as unknown as SessionPayload;
    expect(await createStudent(prisma, student, INPUT)).toEqual({ ok: false, error: 'forbidden' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('У-21/валидация', () => {
  it('без ФИО не создаём', async () => {
    const { prisma, create } = makePrisma();
    const res = await createStudent(prisma, admin(), { ...INPUT, name: '   ' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(create).not.toHaveBeenCalled();
  });

  it('без почты создаём — рабочих обучают без корпоративной (У-21)', async () => {
    const { prisma, create } = makePrisma();
    const res = await createStudent(prisma, admin(), { ...INPUT, email: null });
    expect(res.ok).toBe(true);
    expect(create.mock.calls[0][0].data.email).toBeNull();
  });

  it('кривой СНИЛС отбиваем понятным текстом', async () => {
    const { prisma } = makePrisma();
    const res = await createStudent(prisma, admin(), { ...INPUT, snils: '123' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    if (!res.ok && res.error === 'validation') {
      expect(res.messages?.join()).toContain('11 цифр');
    }
  });
});

describe('У-22: дедупликация', () => {
  it('СНИЛС сравнивается по цифрам — разделители не мешают', () => {
    expect(normalizeSnils('112-233-445 95')).toBe('11223344595');
    expect(normalizeSnils('')).toBeNull();
    expect(normalizeSnils(null)).toBeNull();
  });

  it('совпадение по СНИЛС — создание отбивается кодом duplicate_found', async () => {
    const { prisma, create, findMany } = makePrisma();
    findMany.mockResolvedValueOnce([{ id: 'st-old', name: 'Иванов Иван', snils: '11223344595' }]);

    const res = await createStudent(prisma, admin(), { ...INPUT, snils: '112-233-445 95' });

    expect(res).toMatchObject({ ok: false, error: 'duplicate_found', match: 'snils' });
    expect(create).not.toHaveBeenCalled();
  });

  it('«Всё равно добавить» (force) создаёт, несмотря на дубль', async () => {
    const { prisma, create, findMany } = makePrisma();
    findMany.mockResolvedValue([{ id: 'st-old', name: 'Иванов Иван', snils: '11223344595' }]);

    const res = await createStudent(prisma, admin(), {
      ...INPUT,
      snils: '112-233-445 95',
      force: true,
    });

    expect(res.ok).toBe(true);
    expect(create).toHaveBeenCalled();
  });

  it('порядок ключей: ФИО+ДР проверяется, когда СНИЛС не задан', async () => {
    const { prisma, findMany } = makePrisma();
    findMany.mockResolvedValueOnce([{ id: 'st-2', name: 'Иванов Иван' }]);

    const dup = await findDuplicates(prisma, {
      organizationId: ORG,
      name: 'Иванов Иван',
      birthDate: new Date('1990-01-01'),
    });

    expect(dup?.match).toBe('name_birthdate');
  });

  it('совпадений нет — null', async () => {
    const { prisma } = makePrisma();
    expect(await findDuplicates(prisma, { organizationId: ORG, name: 'Никто' })).toBeNull();
  });
});

describe('изменение и деактивация', () => {
  const EXISTING = { id: 'st-1', organizationId: ORG, name: 'Иванов Иван', status: 'active' };

  it('чужой сотрудник не правится', async () => {
    const { prisma, update } = makePrisma({ orgFound: false, existing: EXISTING });
    const res = await updateStudent(prisma, partner(), {
      id: 'st-1',
      name: 'Другое имя',
      teamMode: false,
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(update).not.toHaveBeenCalled();
  });

  it('несуществующий сотрудник — not_found', async () => {
    const { prisma } = makePrisma({ existing: null });
    expect(await updateStudent(prisma, admin(), { id: 'нет', name: 'X', teamMode: false })).toEqual(
      {
        ok: false,
        error: 'not_found',
      }
    );
  });

  it('деактивация не удаляет запись, а меняет статус', async () => {
    const { prisma, update } = makePrisma({ existing: EXISTING });
    const res = await deactivateStudent(prisma, admin(), { id: 'st-1', teamMode: false });

    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ where: { id: 'st-1' }, data: { status: 'inactive' } });
  });

  it('деактивация чужого сотрудника отбивается', async () => {
    const { prisma, update } = makePrisma({ orgFound: false, existing: EXISTING });
    expect(await deactivateStudent(prisma, partner(), { id: 'st-1', teamMode: false })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('У-31: аудит', () => {
  it('создание пишется в журнал, но БЕЗ персональных данных', async () => {
    const { prisma } = makePrisma();
    await createStudent(prisma, admin(), { ...INPUT, snils: '11223344595' });

    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    const rec = recordAuditMock.mock.calls[0][1];
    expect(rec.action).toBe('student_created');
    expect(rec.entity).toBe('student');
    expect(JSON.stringify(rec)).not.toContain('11223344595');
  });
});
