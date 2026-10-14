import { describe, it, expect, vi } from 'vitest';
import {
  linkCardsToStudentAccounts,
  linkStudentCardsToAccount,
} from '@/lib/services/students/account';
import { getStudentCabinet } from '@/lib/services/students/cabinet';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 2 ТЗ 13.10.2026 (`Р-2-1`, `Р-2-2`): краевые ветки привязки карточек
 * слушателя к учётке, которые на живой базе не воспроизвести (гонка двух
 * подтверждений, карточка без e-mail). Основной путь — в
 * services.students.cabinet.integration.test.ts.
 */

function mockPrisma(over: {
  cards?: { id: string; email: string | null; userId: string | null }[];
  account?: { id: string } | null;
  updated?: number;
  user?: { email: string; role: string; isActive: boolean } | null;
}) {
  return {
    student: {
      findMany: vi.fn().mockResolvedValue(over.cards ?? []),
      updateMany: vi.fn().mockResolvedValue({ count: over.updated ?? 1 }),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(over.account ?? null),
      findUnique: vi.fn().mockResolvedValue(over.user ?? null),
    },
  };
}

describe('linkCardsToStudentAccounts', () => {
  it('пустой список — без запросов в базу', async () => {
    const prisma = mockPrisma({});
    expect(await linkCardsToStudentAccounts(prisma as never, [])).toEqual([]);
    expect(prisma.student.findMany).not.toHaveBeenCalled();
  });

  it('уже связанная карточка возвращается как есть; без e-mail — пропуск', async () => {
    const prisma = mockPrisma({
      cards: [
        { id: 's1', email: 'a@x.test', userId: 'u1' },
        { id: 's2', email: null, userId: null },
        { id: 's3', email: '  ', userId: null },
      ],
    });
    expect(await linkCardsToStudentAccounts(prisma as never, ['s1', 's2', 's3'])).toEqual([
      { studentId: 's1', userId: 'u1' },
    ]);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('гонка: карточку только что связали с другой учёткой — не перехватываем', async () => {
    const prisma = mockPrisma({
      cards: [{ id: 's1', email: 'a@x.test', userId: null }],
      account: { id: 'u1' },
      updated: 0,
    });
    expect(await linkCardsToStudentAccounts(prisma as never, ['s1'])).toEqual([]);
    expect(prisma.student.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', userId: null },
      data: { userId: 'u1' },
    });
  });
});

describe('linkStudentCardsToAccount', () => {
  it('отключённая учётка и пустой адрес ничего не привязывают', async () => {
    const off = mockPrisma({ user: { email: 'a@x.test', role: 'student', isActive: false } });
    expect(await linkStudentCardsToAccount(off as never, 'u1')).toBe(0);
    const blank = mockPrisma({ user: { email: ' ', role: 'student', isActive: true } });
    expect(await linkStudentCardsToAccount(blank as never, 'u1')).toBe(0);
    expect(off.student.updateMany).not.toHaveBeenCalled();
    expect(blank.student.updateMany).not.toHaveBeenCalled();
  });
});

describe('getStudentCabinet — сроки и срок удостоверения не назначены', () => {
  it('null-даты отдаются как null, а не «1970-01-01»', async () => {
    const prisma = {
      ...mockPrisma({ user: null }),
    };
    prisma.student.findMany = vi.fn().mockResolvedValue([
      {
        id: 's1',
        name: 'Анна',
        organization: { name: 'Орг' },
        enrollmentItems: [
          { id: 'i1', status: 'pending', startsOn: null, endsOn: null, direction: { name: 'ОТ' } },
        ],
        certificates: [
          {
            id: 'c1',
            number: 'N1',
            issuedAt: new Date('2026-01-01T00:00:00Z'),
            validUntil: null,
            direction: { name: 'ОТ' },
          },
        ],
      },
    ]);
    const r = await getStudentCabinet(
      prisma as never,
      { sub: 'u1', role: 'student' } as SessionPayload
    );
    expect(r).toEqual({
      ok: true,
      cabinet: {
        name: 'Анна',
        organizations: ['Орг'],
        trainings: [
          {
            id: 'i1',
            directionName: 'ОТ',
            organizationName: 'Орг',
            status: 'pending',
            statusLabel: 'Заявка на рассмотрении',
            startsOn: null,
            endsOn: null,
          },
        ],
        certificates: [
          {
            id: 'c1',
            directionName: 'ОТ',
            number: 'N1',
            issuedAt: '2026-01-01T00:00:00.000Z',
            validUntil: null,
            daysLeft: null,
          },
        ],
      },
    });
  });
});
