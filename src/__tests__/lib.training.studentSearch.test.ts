import { describe, it, expect } from 'vitest';
import { filterStudentsByQuery, studentOptionLabel } from '@/lib/training/studentSearch';

/** Поиск слушателя по ФИО вводом (этап 5 ТЗ 28.10.2026, `У-352`, РК 7). */

const S = [
  { id: '1', name: 'Петров Иван Сергеевич', email: 'petrov@example.com' },
  { id: '2', name: 'Сидорова Алёна', email: null },
  { id: '3', name: 'Иванов Пётр', email: 'ivanov@example.com' },
];
const ids = (q: string) => filterStudentsByQuery(S, q).map((s) => s.id);

describe('filterStudentsByQuery', () => {
  it('пустой запрос (и одни пробелы/знаки) — весь список', () => {
    expect(ids('')).toEqual(['1', '2', '3']);
    expect(ids('  .,  ')).toEqual(['1', '2', '3']);
  });

  it('каждое слово должно найтись — в любом порядке, по части слова', () => {
    expect(ids('иван петров')).toEqual(['1']);
    expect(ids('Петров И')).toEqual(['1']);
    expect(ids('иван')).toEqual(['1', '3']);
  });

  it('регистр и «ё/е» не мешают в обе стороны', () => {
    expect(ids('АЛЕНА')).toEqual(['2']);
    expect(ids('пётр')).toEqual(['1', '3']);
  });

  it('ищет и по почте; слушатель без почты не падает', () => {
    expect(ids('ivanov@')).toEqual(['3']);
    expect(ids('example')).toEqual(['1', '3']);
  });

  it('никого — пустой список', () => {
    expect(ids('ъъъ')).toEqual([]);
  });
});

describe('studentOptionLabel', () => {
  it('почта в скобках — только если она есть', () => {
    expect(studentOptionLabel(S[0]!)).toBe('Петров Иван Сергеевич (petrov@example.com)');
    expect(studentOptionLabel(S[1]!)).toBe('Сидорова Алёна');
  });
});
