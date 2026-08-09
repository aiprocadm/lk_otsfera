/**
 * Импорт сотрудников списком и автосоздание из заявки
 * (`У-27`…`У-29`, этап 5 PR-2).
 *
 * Ключевые инварианты: предпросмотр **ничего не пишет**; подтверждение пишет
 * ровно то, что он показал; одобрение заявки заводит слушателей идемпотентно.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import {
  parseStudentsWorkbook,
  previewStudentImport,
  importStudents,
  STUDENT_IMPORT_COLUMNS,
} from '@/lib/services/students/import';
import { attachStudentsToApprovedItems } from '@/lib/services/students/fromEnrollment';

const ORG = 'org-1';
const admin = (): SessionPayload => ({ sub: 'a1', role: 'admin' }) as unknown as SessionPayload;

async function buildXlsx(rows: unknown[][], headers?: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Сотрудники');
  ws.addRow(
    (headers ?? [
      `${STUDENT_IMPORT_COLUMNS.name}*`,
      STUDENT_IMPORT_COLUMNS.position,
      STUDENT_IMPORT_COLUMNS.snils,
      STUDENT_IMPORT_COLUMNS.birthDate,
      STUDENT_IMPORT_COLUMNS.email,
      STUDENT_IMPORT_COLUMNS.phone,
    ]) as never
  );
  for (const r of rows) ws.addRow(r as never);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

function prismaWith(existing: unknown[] = []) {
  const create = vi.fn().mockResolvedValue({ id: 'new' });
  return {
    prisma: {
      student: { findMany: vi.fn().mockResolvedValue(existing), create },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: ORG }) },
      $transaction: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient,
    create,
  };
}

beforeEach(() => recordAuditMock.mockReset());

describe('У-27: разбор файла', () => {
  it('читает строки; обязательна только ФИО', async () => {
    const buf = await buildXlsx([['Иванов Иван', '', '', '', '', '']]);
    const res = await parseStudentsWorkbook(buf);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]).toMatchObject({ name: 'Иванов Иван', email: null, snils: null });
    }
  });

  it('строка без ФИО даёт понятную ошибку с номером строки', async () => {
    const buf = await buildXlsx([['', 'Слесарь', '', '', 'a@x.ru', '']]);
    const res = await parseStudentsWorkbook(buf);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows).toHaveLength(0);
      expect(res.errors[0]).toContain('Строка 2');
      expect(res.errors[0]).toContain('ФИО');
    }
  });

  it('кривой СНИЛС отбивается построчно', async () => {
    const buf = await buildXlsx([['Иванов Иван', '', '123', '', '', '']]);
    const res = await parseStudentsWorkbook(buf);
    if (!res.ok) throw new Error('ожидали ok');
    expect(res.errors[0]).toContain('11 цифр');
  });

  it('пустые строки в конце файла не считаются ошибкой', async () => {
    const buf = await buildXlsx([
      ['Иванов Иван', '', '', '', '', ''],
      ['', '', '', '', '', ''],
    ]);
    const res = await parseStudentsWorkbook(buf);
    if (!res.ok) throw new Error('ожидали ok');
    expect(res.rows).toHaveLength(1);
    expect(res.errors).toEqual([]);
  });

  it('дата в формате ДД.ММ.ГГГГ понимается', async () => {
    const buf = await buildXlsx([['Иванов Иван', '', '', '01.02.1990', '', '']]);
    const res = await parseStudentsWorkbook(buf);
    if (!res.ok) throw new Error('ожидали ok');
    expect(res.rows[0].birthDate?.getUTCFullYear()).toBe(1990);
  });

  it('файл без колонки ФИО отбивается целиком с подсказкой про шаблон', async () => {
    const buf = await buildXlsx([['x']], ['Что-то не то']);
    const res = await parseStudentsWorkbook(buf);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain('шаблон');
  });

  it('не-Excel отбивается понятным текстом', async () => {
    const res = await parseStudentsWorkbook(Buffer.from('не excel'));
    expect(res.ok).toBe(false);
  });
});

describe('У-28: предпросмотр и подтверждение', () => {
  const ROW = {
    line: 2,
    name: 'Иванов Иван',
    position: null,
    snils: '112-233-445 95',
    birthDate: null,
    email: null,
    phone: null,
  };

  it('предпросмотр НИЧЕГО не пишет', async () => {
    const { prisma, create } = prismaWith();
    const res = await previewStudentImport(prisma, admin(), {
      organizationId: ORG,
      teamMode: false,
      rows: [ROW],
    });

    expect(res.ok).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('совпадение по СНИЛС попадает в дубликаты, а не в создание', async () => {
    const { prisma } = prismaWith([{ id: 'old', name: 'Иванов И.', snils: '11223344595' }]);
    const res = await previewStudentImport(prisma, admin(), {
      organizationId: ORG,
      teamMode: false,
      rows: [ROW],
    });

    if (!res.ok) throw new Error('ожидали ok');
    expect(res.preview.toCreate).toHaveLength(0);
    expect(res.preview.duplicates[0].existingId).toBe('old');
  });

  it('две одинаковые строки внутри файла дают одного сотрудника', async () => {
    const { prisma } = prismaWith();
    const res = await previewStudentImport(prisma, admin(), {
      organizationId: ORG,
      teamMode: false,
      rows: [ROW, { ...ROW, line: 3 }],
    });

    if (!res.ok) throw new Error('ожидали ok');
    expect(res.preview.toCreate).toHaveLength(1);
    expect(res.preview.duplicates).toHaveLength(1);
  });

  it('подтверждение пишет ровно то, что показал предпросмотр — одной транзакцией', async () => {
    const { prisma } = prismaWith();
    const res = await importStudents(prisma, admin(), {
      organizationId: ORG,
      teamMode: false,
      rows: [ROW],
    });

    expect(res).toMatchObject({ ok: true, created: 1, skipped: 0 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
  });

  it('без прав — forbidden и ни одной записи', async () => {
    const { prisma, create } = prismaWith();
    const stranger = { sub: 's', role: 'student' } as unknown as SessionPayload;

    expect(
      await importStudents(prisma, stranger, { organizationId: ORG, teamMode: false, rows: [ROW] })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(create).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });
});

describe('У-29: одобрение заявки заводит слушателей', () => {
  function txWith(items: unknown[], existing: unknown[] = []) {
    const create = vi.fn().mockResolvedValue({ id: 'st-new', name: 'Иванов Иван' });
    const update = vi.fn().mockResolvedValue({});
    return {
      tx: {
        enrollmentRequestItem: { findMany: vi.fn().mockResolvedValue(items), update },
        student: { findMany: vi.fn().mockResolvedValue(existing), create },
      } as unknown as Prisma.TransactionClient,
      create,
      update,
    };
  }

  it('позиция без слушателя создаёт сотрудника и получает studentId', async () => {
    const { tx, create, update } = txWith([
      {
        id: 'it-1',
        fullName: 'Иванов Иван',
        email: 'i@x.ru',
        position: null,
        snils: null,
        birthDate: null,
      },
    ]);

    const res = await attachStudentsToApprovedItems(tx, {
      requestId: 'req-1',
      organizationId: ORG,
    });

    expect(res).toEqual({ created: 1, reused: 0 });
    expect(create).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: 'it-1' }, data: { studentId: 'st-new' } });
  });

  it('совпадение по СНИЛС переиспользует существующего, а не плодит дубль', async () => {
    const { tx, create } = txWith(
      [
        {
          id: 'it-1',
          fullName: 'Иванов Иван',
          email: 'i@x.ru',
          position: null,
          snils: '112-233-445 95',
          birthDate: null,
        },
      ],
      [{ id: 'st-old', name: 'Иванов И.', snils: '11223344595', birthDate: null, email: null }]
    );

    const res = await attachStudentsToApprovedItems(tx, {
      requestId: 'req-1',
      organizationId: ORG,
    });

    expect(res).toEqual({ created: 0, reused: 1 });
    expect(create).not.toHaveBeenCalled();
  });

  it('идемпотентно: позиций без слушателя нет — ничего не делаем', async () => {
    const { tx, create } = txWith([]);
    expect(
      await attachStudentsToApprovedItems(tx, { requestId: 'r', organizationId: ORG })
    ).toEqual({ created: 0, reused: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it('две одинаковые позиции в одной заявке дают одного сотрудника', async () => {
    const { tx, create } = txWith([
      {
        id: 'it-1',
        fullName: 'Иванов Иван',
        email: 'i@x.ru',
        position: null,
        snils: null,
        birthDate: null,
      },
      {
        id: 'it-2',
        fullName: 'Иванов Иван',
        email: 'i@x.ru',
        position: null,
        snils: null,
        birthDate: null,
      },
    ]);

    const res = await attachStudentsToApprovedItems(tx, { requestId: 'r', organizationId: ORG });

    expect(res).toEqual({ created: 1, reused: 1 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
