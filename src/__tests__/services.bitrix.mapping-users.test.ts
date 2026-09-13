import { describe, expect, it } from 'vitest';

import { assigneeFor, mapUsers } from '@/lib/services/bitrix/mapping/users';
import type { CompanyUser } from '@/lib/services/bitrix/mapping/users';
import type { BitrixUserLike } from '@/lib/services/bitrix/mapping/types';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-192`): пользователи портала → сотрудники ЛК.
 * Новых пользователей миграция НЕ создаёт: сопоставляет по почте среди
 * сотрудников компании-исполнителя, уважает сохранённую таблицу администратора,
 * а несопоставленным отдаёт менеджера по умолчанию.
 */

const IVAN: CompanyUser = { id: 'u-ivan', email: 'ivan@example.ru', name: 'Иван Петров' };
const OLGA: CompanyUser = { id: 'u-olga', email: 'olga@example.ru', name: 'Ольга Смирнова' };

const bitrixUser = (over: Partial<BitrixUserLike> = {}): BitrixUserLike => ({
  id: '1',
  email: 'ivan@example.ru',
  name: 'Иван П.',
  ...over,
});

describe('mapUsers — сопоставление по почте', () => {
  it.each([
    ['точное совпадение', 'ivan@example.ru'],
    ['другой регистр', 'IVAN@EXAMPLE.RU'],
    ['смешанный регистр', 'Ivan@Example.Ru'],
    ['пробелы по краям', '  ivan@example.ru  '],
    ['пробелы и регистр вместе', ' IVAN@Example.RU '],
  ] as const)('%s («%s») находит сотрудника ЛК', (_name, email) => {
    const { rows, resolve } = mapUsers([bitrixUser({ email })], [IVAN, OLGA], {});
    expect(rows).toEqual([
      { bitrixId: '1', name: 'Иван П.', email, userId: 'u-ivan', matchedBy: 'email' },
    ]);
    expect(resolve('1')).toBe('u-ivan');
  });

  it('почта сотрудника ЛК тоже приводится к нижнему регистру и обрезается', () => {
    const noisy: CompanyUser = { id: 'u-ivan', email: '  IVAN@Example.RU ', name: 'Иван Петров' };
    const { rows } = mapUsers([bitrixUser({ email: 'ivan@example.ru' })], [noisy], {});
    expect(rows[0].userId).toBe('u-ivan');
    expect(rows[0].matchedBy).toBe('email');
  });

  it('строка сохраняет исходную почту портала, а не нормализованную', () => {
    // В таблице предпросмотра человек должен видеть то, что написано в Битриксе.
    const { rows } = mapUsers([bitrixUser({ email: '  IVAN@EXAMPLE.RU ' })], [IVAN], {});
    expect(rows[0].email).toBe('  IVAN@EXAMPLE.RU ');
  });

  it('чужая почта никого не находит', () => {
    const { rows, resolve } = mapUsers([bitrixUser({ email: 'nobody@example.ru' })], [IVAN], {});
    expect(rows[0]).toEqual({
      bitrixId: '1',
      name: 'Иван П.',
      email: 'nobody@example.ru',
      userId: null,
      matchedBy: 'none',
    });
    expect(resolve('1')).toBeNull();
  });

  it('два сотрудника ЛК с одинаковой почтой — берётся первый', () => {
    const twin: CompanyUser = { id: 'u-twin', email: 'IVAN@example.ru', name: 'Иван Дубль' };
    const { rows } = mapUsers([bitrixUser()], [IVAN, twin], {});
    expect(rows[0].userId).toBe('u-ivan');
  });

  it('сотрудник ЛК с пустой почтой не занимает место в индексе', () => {
    // Иначе первый же безпочтовый сотрудник «поймал» бы всех безпочтовых из портала.
    const ghost: CompanyUser = { id: 'u-ghost', email: '   ', name: 'Без почты' };
    const { rows } = mapUsers([bitrixUser({ email: '   ' })], [ghost, IVAN], {});
    expect(rows[0]).toMatchObject({ userId: null, matchedBy: 'none' });
  });

  it.each([
    ['почты нет вовсе (null)', null],
    ['почта пустой строкой', ''],
    ['почта из одних пробелов', '   '],
  ] as const)('%s → userId null и matchedBy «none»', (_name, email) => {
    const { rows, resolve } = mapUsers([bitrixUser({ email })], [IVAN], {});
    expect(rows[0]).toEqual({
      bitrixId: '1',
      name: 'Иван П.',
      email,
      userId: null,
      matchedBy: 'none',
    });
    expect(resolve('1')).toBeNull();
  });

  it('порядок строк — как в источнике, по строке на каждого пользователя портала', () => {
    const { rows } = mapUsers(
      [
        bitrixUser({ id: '1', email: 'olga@example.ru', name: 'Ольга' }),
        bitrixUser({ id: '2', email: null, name: 'Пётр' }),
        bitrixUser({ id: '3', email: 'ivan@example.ru', name: 'Иван' }),
      ],
      [IVAN, OLGA],
      {}
    );
    expect(rows.map((r) => [r.bitrixId, r.userId])).toEqual([
      ['1', 'u-olga'],
      ['2', null],
      ['3', 'u-ivan'],
    ]);
  });

  it('пустой источник даёт пустую таблицу', () => {
    const { rows, resolve } = mapUsers([], [IVAN], {});
    expect(rows).toEqual([]);
    expect(resolve('1')).toBeNull();
  });
});

describe('mapUsers — сохранённая таблица администратора', () => {
  it('таблица СИЛЬНЕЕ почты: администратор развёл однофамильцев вручную', () => {
    const { rows, resolve } = mapUsers([bitrixUser({ email: 'ivan@example.ru' })], [IVAN, OLGA], {
      '1': 'u-olga',
    });
    expect(rows[0]).toEqual({
      bitrixId: '1',
      name: 'Иван П.',
      email: 'ivan@example.ru',
      userId: 'u-olga',
      matchedBy: 'table',
    });
    expect(resolve('1')).toBe('u-olga');
  });

  it('таблица работает и там, где почты нет вовсе', () => {
    const { rows } = mapUsers([bitrixUser({ email: null })], [IVAN], { '1': 'u-ivan' });
    expect(rows[0]).toMatchObject({ userId: 'u-ivan', matchedBy: 'table' });
  });

  it('запись на УВОЛЕННОГО (не из компании) игнорируется — спасает почта', () => {
    // Иначе задачи и заказы уехали бы на пользователя, которого в компании нет.
    const { rows, resolve } = mapUsers([bitrixUser({ email: 'ivan@example.ru' })], [IVAN], {
      '1': 'u-fired',
    });
    expect(rows[0]).toMatchObject({ userId: 'u-ivan', matchedBy: 'email' });
    expect(resolve('1')).toBe('u-ivan');
  });

  it('запись на уволенного без почты → никого: строка ждёт менеджера по умолчанию', () => {
    const { rows, resolve } = mapUsers([bitrixUser({ email: null })], [IVAN], { '1': 'u-fired' });
    expect(rows[0]).toMatchObject({ userId: null, matchedBy: 'none' });
    expect(resolve('1')).toBeNull();
  });

  it('пустая строка в таблице — это «не сопоставлено», а не идентификатор', () => {
    const { rows } = mapUsers([bitrixUser({ email: 'ivan@example.ru' })], [IVAN], { '1': '' });
    expect(rows[0]).toMatchObject({ userId: 'u-ivan', matchedBy: 'email' });
  });

  it('запись про чужого пользователя портала на строку не влияет', () => {
    const { rows } = mapUsers([bitrixUser({ id: '1', email: null })], [IVAN], { '99': 'u-ivan' });
    expect(rows[0]).toMatchObject({ userId: null, matchedBy: 'none' });
  });
});

describe('mapUsers — resolve', () => {
  it('неизвестный пользователь портала → null', () => {
    const { resolve } = mapUsers([bitrixUser()], [IVAN], {});
    expect(resolve('404')).toBeNull();
  });

  it('«ответственного нет» (null) → null, без похода в таблицу', () => {
    const { resolve } = mapUsers([bitrixUser()], [IVAN], {});
    expect(resolve(null)).toBeNull();
  });

  it('пустая строка вместо идентификатора → null', () => {
    const { resolve } = mapUsers([bitrixUser()], [IVAN], {});
    expect(resolve('')).toBeNull();
  });
});

describe('assigneeFor — кому достанется строка', () => {
  const ctxOf = (resolved: string | null, defaultManagerId: string | null) => ({
    defaultManagerId,
    resolveUser: () => resolved,
  });

  it.each([
    ['сопоставленный пользователь — он и есть', 'u-ivan', 'u-default', 'u-ivan'],
    ['не сопоставлен — менеджер по умолчанию', null, 'u-default', 'u-default'],
    ['не сопоставлен и менеджера нет — назначать некому', null, null, null],
    ['сопоставлен, а менеджера нет — всё равно он', 'u-ivan', null, 'u-ivan'],
  ] as const)('%s', (_name, resolved, defaultManagerId, expected) => {
    expect(assigneeFor('1', ctxOf(resolved, defaultManagerId))).toBe(expected);
  });

  it('ответственного в Битриксе не было (null) — работает менеджер по умолчанию', () => {
    const { resolve } = mapUsers([bitrixUser()], [IVAN], {});
    expect(assigneeFor(null, { defaultManagerId: 'u-default', resolveUser: resolve })).toBe(
      'u-default'
    );
  });

  it('живой resolve из mapUsers подставляет найденного сотрудника', () => {
    const { resolve } = mapUsers([bitrixUser()], [IVAN], {});
    expect(assigneeFor('1', { defaultManagerId: 'u-default', resolveUser: resolve })).toBe(
      'u-ivan'
    );
  });
});
