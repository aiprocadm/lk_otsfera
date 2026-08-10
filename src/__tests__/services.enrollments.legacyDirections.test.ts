/**
 * Разбор старых заявок без направления (`У-34а`, этап 6 ТЗ понятности).
 *
 * Главные инварианты: отчёт видит **только** неразобранные заявки; проставление
 * пишет направление **позициям** (шапка объявлена устаревшей, `У-36`); чужого
 * направления не существует — отказ, а не тихая запись.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import {
  listLegacyEnrollments,
  countLegacyEnrollments,
  assignLegacyDirection,
} from '@/lib/services/enrollments/legacyDirections';

const admin = (): SessionPayload => ({ sub: 'a1', role: 'admin' }) as unknown as SessionPayload;

function makePrisma(
  opts: {
    requests?: unknown[];
    count?: number;
    direction?: unknown;
    request?: unknown;
  } = {}
) {
  const updateMany = vi.fn().mockResolvedValue({ count: 3 });
  return {
    prisma: {
      enrollmentRequest: {
        findMany: vi.fn().mockResolvedValue(opts.requests ?? []),
        count: vi.fn().mockResolvedValue(opts.count ?? 0),
        findUnique: vi
          .fn()
          .mockResolvedValue(
            opts.request === undefined
              ? { id: 'r1', legacyCourseTitle: 'Электробезопасность' }
              : opts.request
          ),
      },
      enrollmentRequestItem: { updateMany },
      trainingDirection: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            opts.direction === undefined
              ? { id: 'd1', name: 'Электробезопасность' }
              : opts.direction
          ),
      },
    } as unknown as PrismaClient,
    updateMany,
  };
}

beforeEach(() => recordAuditMock.mockReset());

describe('У-34а: отчёт по неразобранным заявкам', () => {
  it('пустой список — разбирать нечего', async () => {
    const { prisma } = makePrisma();
    expect(await listLegacyEnrollments(prisma)).toEqual([]);
  });

  it('строка отчёта показывает организацию, текст курса и число слушателей', async () => {
    const { prisma } = makePrisma({
      requests: [
        {
          id: 'r1',
          createdAt: new Date('2026-01-15'),
          legacyCourseTitle: 'Работы на высоте',
          organization: { name: 'ООО Ромашка' },
          _count: { items: 4 },
        },
      ],
    });

    const rows = await listLegacyEnrollments(prisma);

    expect(rows[0]).toMatchObject({
      organizationName: 'ООО Ромашка',
      legacyCourseTitle: 'Работы на высоте',
      itemsCount: 4,
    });
  });

  it('заявка без организации не роняет отчёт', async () => {
    const { prisma } = makePrisma({
      requests: [
        {
          id: 'r2',
          createdAt: new Date(),
          legacyCourseTitle: null,
          organization: null,
          _count: { items: 0 },
        },
      ],
    });

    expect((await listLegacyEnrollments(prisma))[0]?.organizationName).toBe(
      'Организация не указана'
    );
  });

  it('счётчик для стража «замка» возвращает число', async () => {
    const { prisma } = makePrisma({ count: 7 });
    expect(await countLegacyEnrollments(prisma)).toBe(7);
  });
});

describe('У-34а: проставление направления', () => {
  it('пишет направление ПОЗИЦИЯМ заявки, а не шапке', async () => {
    const { prisma, updateMany } = makePrisma();

    const res = await assignLegacyDirection(prisma, admin(), {
      requestId: 'r1',
      directionId: 'd1',
    });

    expect(res).toEqual({ ok: true, updated: 3 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { requestId: 'r1', directionId: null },
      data: { directionId: 'd1' },
    });
  });

  it('несуществующее направление — отказ, ничего не пишем', async () => {
    const { prisma, updateMany } = makePrisma({ direction: null });

    expect(
      await assignLegacyDirection(prisma, admin(), { requestId: 'r1', directionId: 'нет' })
    ).toEqual({ ok: false, error: 'validation' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('несуществующая заявка — not_found, ничего не пишем', async () => {
    const { prisma, updateMany } = makePrisma({ request: null });

    expect(
      await assignLegacyDirection(prisma, admin(), { requestId: 'нет', directionId: 'd1' })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('операция попадает в журнал аудита с названием направления', async () => {
    const { prisma } = makePrisma();

    await assignLegacyDirection(prisma, admin(), { requestId: 'r1', directionId: 'd1' });

    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    const rec = recordAuditMock.mock.calls[0][1];
    expect(rec.action).toBe('enrollment_legacy_direction_assigned');
    expect(rec.after).toMatchObject({ directionName: 'Электробезопасность', items: 3 });
  });
});
