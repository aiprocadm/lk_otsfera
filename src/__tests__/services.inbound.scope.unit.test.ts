import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { inboxScopeWhere, isInboundMessageInScope } from '@/lib/services/inbound/scope';

/**
 * Матрица эквивалентности C8-scope (E2, из ревью E1): Prisma-where
 * `inboxScopeWhere` и in-memory `isInboundMessageInScope` обязаны давать
 * одинаковый вердикт на каждой комбинации
 * (msg.companyId свой/чужой/null × status × session.companyId задан/null).
 * Where оценивается структурным интерпретатором канонической формы
 * `{ OR: [{ companyId }, { status }] }` с Prisma-семантикой equals
 * (null-колонка НЕ матчится строковым фильтром) — тест ловит рассинхрон
 * реализаций, а не копирует одну из них.
 */

function session(companyId: string | null): SessionPayload {
  return { sub: 'u-1', role: 'manager', companyId } as SessionPayload;
}

type Msg = { companyId: string | null; status: string };

function matchesWhere(where: Prisma.InboundMessageWhereInput, msg: Msg): boolean {
  const or = where.OR as Array<Record<string, unknown>>;
  expect(Array.isArray(or)).toBe(true);
  // Каждая клауза — РОВНО один ключ из известного множества. Неизвестная
  // форма where обязана РОНЯТЬ тест, а не молча оцениваться в false
  // (иначе усложнённый scope прошёл бы матрицу «эквивалентным» по ошибке).
  for (const clause of or) {
    const keys = Object.keys(clause);
    expect(keys).toHaveLength(1);
    expect(['companyId', 'status']).toContain(keys[0]);
  }
  return or.some((clause) =>
    'companyId' in clause ? msg.companyId === clause.companyId : msg.status === clause.status
  );
}

// [session.companyId, msg.companyId, msg.status, ожидаемый inScope]
const MATRIX: Array<[string | null, string | null, string, boolean]> = [
  ['co-a', 'co-a', 'unresolved', true],
  ['co-a', 'co-a', 'bound', true],
  ['co-a', 'co-a', 'archived', true],
  ['co-a', 'co-b', 'unresolved', true],
  ['co-a', 'co-b', 'bound', false],
  ['co-a', 'co-b', 'archived', false],
  ['co-a', null, 'unresolved', true],
  ['co-a', null, 'bound', false],
  ['co-a', null, 'archived', false],
  [null, 'co-a', 'unresolved', true],
  [null, 'co-a', 'bound', false],
  [null, 'co-a', 'archived', false],
  [null, 'co-b', 'unresolved', true],
  [null, 'co-b', 'bound', false],
  [null, 'co-b', 'archived', false],
  [null, null, 'unresolved', true],
  [null, null, 'bound', false],
  [null, null, 'archived', false],
];

describe('inbound scope: матрица эквивалентности where ↔ предикат', () => {
  it.each(MATRIX)(
    'session.companyId=%s, msg.companyId=%s, status=%s → inScope=%s (обе реализации)',
    (sessionCompanyId, msgCompanyId, status, expected) => {
      const s = session(sessionCompanyId);
      const msg: Msg = { companyId: msgCompanyId, status };
      expect(isInboundMessageInScope(s, msg)).toBe(expected);
      expect(matchesWhere(inboxScopeWhere(s), msg)).toBe(expected);
    }
  );
});

describe('inboxScopeWhere: структура where', () => {
  it('сессия с companyId — фильтр по своей компании + общая unresolved-очередь', () => {
    expect(inboxScopeWhere(session('co-a'))).toEqual({
      OR: [{ companyId: 'co-a' }, { status: 'unresolved' }],
    });
  });

  it('companyId=null — deny-all сентинел на ветке компании (не company-wide утечка)', () => {
    expect(inboxScopeWhere(session(null))).toEqual({
      OR: [{ companyId: '__no_company__' }, { status: 'unresolved' }],
    });
  });

  it('companyId отсутствует (undefined) — тот же сентинел; предикат тоже deny', () => {
    const s = { sub: 'u-1', role: 'manager' } as SessionPayload;
    expect(inboxScopeWhere(s)).toEqual({
      OR: [{ companyId: '__no_company__' }, { status: 'unresolved' }],
    });
    expect(isInboundMessageInScope(s, { companyId: 'co-a', status: 'bound' })).toBe(false);
  });
});
