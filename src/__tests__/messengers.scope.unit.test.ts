import { describe, it, expect } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { ScopeLevel, SessionAccessProfile } from '@/lib/auth/accessProfile';
import { dialogScopeWhere, isDialogInScope } from '@/lib/services/messengers/scope';

/**
 * Матрица эквивалентности скоупа диалогов (спека 2026-09-12, Р-М-3; охваты —
 * `У-214`): Prisma-форма и in-memory двойник обязаны означать одно и то же.
 * Образец — `services.inbound.scope.unit.test.ts`.
 *
 * Зачем вообще такая матрица. Список диалогов фильтрует БАЗА
 * (`dialogScopeWhere`), а открытие карточки, отправку, назначение и вложение
 * проверяет ПАМЯТЬ (`isDialogInScope`). Разъедутся — и получится либо дыра (в
 * списке не видно, а по прямой ссылке открывается), либо привидение (в списке
 * видно, а внутрь не пускает). Обе беды тихие, поэтому равенство проверяется
 * перебором, а не парой примеров.
 */

type Dialog = {
  companyId: string | null;
  assigneeId: string | null;
  organizationId: string | null;
};

/**
 * Эталонный «мини-Prisma»: считает руками, подходит ли диалог под where.
 * Написан ЗДЕСЬ и независимо от продового кода — иначе тест сравнивал бы
 * функцию саму с собой. Понимает ровно те формы, которые строит
 * `dialogWhereForLevel`: `OR`, `AND`, равенство поля и `{ in: [...] }`.
 */
function whereMatches(where: Prisma.MessengerDialogWhereInput, dialog: Dialog): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') {
      return (cond as Prisma.MessengerDialogWhereInput[]).some((c) => whereMatches(c, dialog));
    }
    if (key === 'AND') {
      return (cond as Prisma.MessengerDialogWhereInput[]).every((c) => whereMatches(c, dialog));
    }
    const actual = dialog[key as keyof Dialog] ?? null;
    if (cond !== null && typeof cond === 'object' && 'in' in (cond as object)) {
      // Как у Prisma: NULL не входит ни в один список значений.
      return actual !== null && ((cond as { in: string[] }).in ?? []).includes(actual);
    }
    return actual === (cond ?? null);
  });
}

const ME = 'm';
const MY_COMPANY = 'A';
const MY_ORG = 'o1';

function profile(dialogs: ScopeLevel): SessionAccessProfile {
  return {
    id: 'p1',
    name: 'Роль',
    orders: 'all',
    organizations: 'all',
    threads: 'all',
    documents: 'all',
    finance: 'all',
    leads: 'all',
    tasks: 'all',
    dialogs,
    capabilities: [],
  };
}

function session(over: Partial<SessionPayload> = {}): SessionPayload {
  return {
    sub: ME,
    role: 'manager',
    companyId: MY_COMPANY,
    managedOrgIds: [MY_ORG],
    ...over,
  } as SessionPayload;
}

const withCompany = session();
const noCompany = session({ companyId: null });

describe('dialogScopeWhere ↔ isDialogInScope: граница компании (охват «всё»)', () => {
  it.each([
    ['своя компания', withCompany, 'A', true],
    ['чужая компания', withCompany, 'B', false],
    ['общая очередь', withCompany, null, true],
    ['сессия без компании — чужая компания', noCompany, 'A', false],
    ['сессия без компании — общая очередь', noCompany, null, true],
  ])('%s', (_name, s, companyId, expected) => {
    const dialog: Dialog = { companyId, assigneeId: null, organizationId: null };
    expect(isDialogInScope(s, dialog)).toBe(expected);
    expect(whereMatches(dialogScopeWhere(s), dialog)).toBe(expected);
  });

  it('сессия без компании получает страховочный sentinel, а не пустой фильтр', () => {
    // `companyId: undefined` снял бы фильтр целиком — сессия без компании
    // увидела бы переписку всех компаний сразу.
    expect(dialogScopeWhere(noCompany)).toEqual({
      OR: [{ companyId: '__no_company__' }, { companyId: null }],
    });
    expect(dialogScopeWhere(withCompany)).toEqual({
      OR: [{ companyId: 'A' }, { companyId: null }],
    });
  });
});

// ── Полная матрица по трём уровням охвата (`У-214`) ──────────────────────────
const COMPANIES = [MY_COMPANY, 'B', null];
const ASSIGNEES = [ME, 'other', null];
const ORGS = [MY_ORG, 'o-foreign', null];

const ALL_DIALOGS: Dialog[] = COMPANIES.flatMap((companyId) =>
  ASSIGNEES.flatMap((assigneeId) =>
    ORGS.map((organizationId) => ({ companyId, assigneeId, organizationId }))
  )
);

/**
 * Эталон «кто что видит», выписанный по требованию `У-214`, а НЕ вызовом
 * продовой функции:
 *  - ничейный диалог (`companyId IS NULL`) виден всегда — это общая очередь
 *    разбора; сузить её значило бы, что новое обращение не видит никто;
 *  - чужая компания — никогда (C8);
 *  - дальше решает уровень: `all` — вся компания, `own` — где я ответственный,
 *    `assigned` — плюс переписка закреплённых за мной организаций.
 */
function expectedVisible(s: SessionPayload, level: ScopeLevel, d: Dialog): boolean {
  if (d.companyId === null) return true;
  if (s.companyId === null || d.companyId !== s.companyId) return false;
  if (level === 'all') return true;
  const mine = d.assigneeId === ME;
  if (level === 'own') return mine;
  return mine || (d.organizationId !== null && (s.managedOrgIds ?? []).includes(d.organizationId));
}

describe('охват диалогов профиля доступа (`У-214`)', () => {
  it.each(['all', 'assigned', 'own'] as const)(
    'уровень «%s»: обе формы согласны друг с другом и с требованием на всех 27 диалогах',
    (level) => {
      // Вторая сессия — без компании: у неё срабатывает страховочный sentinel,
      // и ни один диалог компании не должен пройти ни на одном уровне.
      const sessions = [
        session({ accessProfile: profile(level) }),
        session({ companyId: null, accessProfile: profile(level) }),
      ];
      for (const sess of sessions) {
        const where = dialogScopeWhere(sess);
        for (const dialog of ALL_DIALOGS) {
          const expected = expectedVisible(sess, level, dialog);
          const hint = `${level}: ${JSON.stringify(dialog)} (компания сессии ${sess.companyId})`;
          expect(isDialogInScope(sess, dialog), `память — ${hint}`).toBe(expected);
          expect(whereMatches(where, dialog), `Prisma — ${hint}`).toBe(expected);
        }
      }
    }
  );

  it('нет профиля — ровно то же, что уровень «всё» (правило наслоения §2b)', () => {
    // Суть правила: включение новой шкалы НЕ должно ничего отнять у уже
    // заведённых профилей и у сессий без профиля вовсе.
    const noProfile = session();
    const allLevel = session({ accessProfile: profile('all') });
    expect(dialogScopeWhere(noProfile)).toEqual(dialogScopeWhere(allLevel));
    for (const dialog of ALL_DIALOGS) {
      expect(isDialogInScope(noProfile, dialog), JSON.stringify(dialog)).toBe(
        isDialogInScope(allLevel, dialog)
      );
    }
  });

  it('«свои» вложены в «закреплённые», а те — во «все»: охваты не пересекаются крест-накрест', () => {
    // Если вложенность сломается (например, `own` начнёт показывать чужое),
    // матрица выше это поймает, но именно эта проверка называет беду словами.
    const visible = (level: ScopeLevel) =>
      ALL_DIALOGS.filter((d) => isDialogInScope(session({ accessProfile: profile(level) }), d));
    const own = visible('own');
    const assigned = visible('assigned');
    const all = visible('all');
    expect(own.length).toBeLessThan(assigned.length);
    expect(assigned.length).toBeLessThan(all.length);
    for (const d of own) expect(assigned).toContainEqual(d);
    for (const d of assigned) expect(all).toContainEqual(d);
  });

  it('чужая компания не видна ни на одном уровне охвата', () => {
    // C8: охват профиля сужает видимость внутри компании и НИКОГДА не
    // расширяет её наружу.
    for (const level of ['all', 'assigned', 'own'] as const) {
      const sess = session({ accessProfile: profile(level) });
      const foreign: Dialog = { companyId: 'B', assigneeId: ME, organizationId: MY_ORG };
      expect(isDialogInScope(sess, foreign), level).toBe(false);
      expect(whereMatches(dialogScopeWhere(sess), foreign), level).toBe(false);
    }
  });

  it('общая очередь ничейных остаётся видна даже на самом узком охвате', () => {
    // Иначе первое обращение незнакомого человека не увидел бы никто, и
    // «Входящие» молча превратились бы в чёрную дыру.
    const sess = session({ accessProfile: profile('own') });
    const unbound: Dialog = { companyId: null, assigneeId: 'other', organizationId: 'o-foreign' };
    expect(isDialogInScope(sess, unbound)).toBe(true);
    expect(whereMatches(dialogScopeWhere(sess), unbound)).toBe(true);
  });
});

describe('роль решает раньше охвата', () => {
  it('клиентские роли не видят переписку вообще — даже ничейную', () => {
    // До этапа 3 in-memory проверка роль не смотрела, и ничейный диалог
    // формально проходил для любой сессии. Теперь заказчик и партнёр
    // отсекаются раньше: диалоги — внутренний инструмент отдела продаж.
    for (const role of ['partner', 'organization', 'student'] as const) {
      const s = session({ role });
      expect(isDialogInScope(s, { companyId: null, assigneeId: null, organizationId: null })).toBe(
        false
      );
      expect(
        isDialogInScope(s, { companyId: MY_COMPANY, assigneeId: ME, organizationId: MY_ORG })
      ).toBe(false);
    }
  });

  it('руководитель — тот же контур, что менеджер: охват действует и на него', () => {
    const leader = session({ role: 'leader', accessProfile: profile('own') });
    expect(
      isDialogInScope(leader, { companyId: MY_COMPANY, assigneeId: ME, organizationId: null })
    ).toBe(true);
    expect(
      isDialogInScope(leader, { companyId: MY_COMPANY, assigneeId: 'other', organizationId: null })
    ).toBe(false);
  });
});
