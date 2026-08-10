/**
 * Сверка названий направлений из файла со справочником (`У-41`, этап 6).
 *
 * Главное: нераспознанное название — **ошибка строки с перечнем допустимых
 * значений**, а не тихий пропуск. Человек должен видеть, что писать (§15).
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  resolveDirectionNames,
  normalizeDirectionName,
} from '@/lib/services/enrollments/resolveDirections';

function prismaWith(directions: Array<{ id: string; name: string }>) {
  return {
    trainingDirection: { findMany: vi.fn().mockResolvedValue(directions) },
  } as unknown as PrismaClient;
}

const DIRECTIONS = [
  { id: 'd1', name: 'Электробезопасность' },
  { id: 'd2', name: 'Работы на высоте' },
];

describe('normalizeDirectionName', () => {
  it('не различает регистр, «ё/е» и лишние пробелы', () => {
    expect(normalizeDirectionName('  Работы   НА  Высоте ')).toBe('работы на высоте');
    expect(normalizeDirectionName('Ёлочные работы')).toBe(normalizeDirectionName('Елочные работы'));
  });
});

describe('У-41: сверка направлений со справочником', () => {
  it('находит направление независимо от регистра и пробелов', async () => {
    const res = await resolveDirectionNames(prismaWith(DIRECTIONS), ['  работы на ВЫСОТЕ ']);
    expect(res.ids).toEqual(['d2']);
    expect(res.errors).toEqual([]);
  });

  it('пустое название — не ошибка, просто нет направления', async () => {
    const res = await resolveDirectionNames(prismaWith(DIRECTIONS), [null, '']);
    expect(res.ids).toEqual([null, null]);
    expect(res.errors).toEqual([]);
  });

  it('нераспознанное название даёт ошибку строки с перечнем допустимых', async () => {
    const res = await resolveDirectionNames(prismaWith(DIRECTIONS), ['Полёты на Марс']);

    expect(res.ids).toEqual([null]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain('Строка 2');
    expect(res.errors[0]).toContain('Полёты на Марс');
    expect(res.errors[0]).toContain('Электробезопасность');
    expect(res.errors[0]).toContain('Работы на высоте');
  });

  it('пустой справочник — говорим об этом прямо, а не молчим', async () => {
    const res = await resolveDirectionNames(prismaWith([]), ['Что угодно']);
    expect(res.errors[0]).toContain('Справочник направлений пуст');
  });

  it('нумерация строк настраивается вызывающим', async () => {
    const res = await resolveDirectionNames(
      prismaWith(DIRECTIONS),
      ['нет такого'],
      (i) => `Слушатель ${i + 1}`
    );
    expect(res.errors[0]).toContain('Слушатель 1');
  });
});
