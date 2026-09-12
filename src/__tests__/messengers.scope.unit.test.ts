import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import { dialogScopeWhere, isDialogInScope } from '@/lib/services/messengers/scope';

/**
 * Матрица эквивалентности скоупа диалогов (спека 2026-09-12, Р-М-3): Prisma-
 * форма и in-memory двойник обязаны означать одно и то же. Образец —
 * `services.inbound.scope.unit.test.ts`.
 */
const withCompany = { sub: 'm', role: 'manager', companyId: 'A' } as SessionPayload;
const noCompany = { sub: 'm', role: 'manager', companyId: null } as SessionPayload;

/** Эталон поведения Prisma-формы для одного диалога — считается руками. */
function whereMatches(session: SessionPayload, dialog: { companyId: string | null }): boolean {
  const where = dialogScopeWhere(session);
  return where.OR!.some((clause) => clause.companyId === dialog.companyId);
}

describe('dialogScopeWhere ↔ isDialogInScope', () => {
  const dialogs = [{ companyId: 'A' }, { companyId: 'B' }, { companyId: null }];

  it.each([
    ['своя компания', withCompany, 'A', true],
    ['чужая компания', withCompany, 'B', false],
    ['общая очередь', withCompany, null, true],
    ['сессия без компании — чужая компания', noCompany, 'A', false],
    ['сессия без компании — общая очередь', noCompany, null, true],
  ])('%s', (_name, session, companyId, expected) => {
    const dialog = { companyId };
    expect(isDialogInScope(session, dialog)).toBe(expected);
    expect(whereMatches(session, dialog)).toBe(expected);
  });

  it('обе формы совпадают на всей матрице', () => {
    for (const session of [withCompany, noCompany]) {
      for (const dialog of dialogs) {
        expect(isDialogInScope(session, dialog)).toBe(whereMatches(session, dialog));
      }
    }
  });

  it('сессия без компании получает страховочный sentinel, а не пустой фильтр', () => {
    expect(dialogScopeWhere(noCompany)).toEqual({
      OR: [{ companyId: '__no_company__' }, { companyId: null }],
    });
    expect(dialogScopeWhere(withCompany)).toEqual({
      OR: [{ companyId: 'A' }, { companyId: null }],
    });
  });
});
