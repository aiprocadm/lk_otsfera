import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  canSeeDialog,
  dialogWhereForLevel,
  NO_COMPANY_SENTINEL,
  type ScopeLevel,
  type SessionAccessProfile,
} from '@/lib/auth/accessProfile';
import { dialogMatchesWhere, type DialogRow } from './helpers/dialogWhere';

/**
 * Охват переписки в профиле доступа (`У-214`, этап 3 PR-7).
 *
 * До этапа 3 видимость диалогов держалась только на компании: любой сотрудник
 * видел любую переписку своей компании. Теперь поверх компании действует
 * охват — как у заказов и задач. Особенность ровно одна, и она здесь главная:
 * **ничейные диалоги видны на любом охвате**. Это общая очередь разбора —
 * сообщения от людей, которых система ещё не узнала. Сузить её значило бы, что
 * новое обращение клиента не видит НИКТО, и обнаружилось бы это только по
 * жалобе клиента, а не по красному тесту.
 */

const profile = (dialogs: ScopeLevel): SessionAccessProfile => ({
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
});

function mgr(over: Partial<SessionPayload> = {}): SessionPayload {
  return {
    sub: 'u1',
    role: 'manager',
    companyId: 'co-1',
    managedOrgIds: ['o1'],
    ...over,
  } as unknown as SessionPayload;
}

/** Сотрудник с заданным охватом переписки. */
const withLevel = (level: ScopeLevel, over: Partial<SessionPayload> = {}): SessionPayload =>
  mgr({ accessProfile: profile(level), ...over } as Partial<SessionPayload>);

const dialog = (over: Partial<DialogRow> = {}): DialogRow => ({
  companyId: 'co-1',
  assigneeId: 'u2',
  organizationId: null,
  ...over,
});

/** Четыре характерных диалога — на них считается вся матрица охватов. */
const MINE = dialog({ assigneeId: 'u1' });
const COLLEAGUE = dialog({ assigneeId: 'u2' });
const MANAGED_ORG = dialog({ assigneeId: 'u2', organizationId: 'o1' });
const OTHER_COMPANY = dialog({ companyId: 'co-2', assigneeId: 'u1', organizationId: 'o1' });
const UNBOUND = dialog({ companyId: null, assigneeId: null });

describe('dialogWhereForLevel() — условие выборки диалогов', () => {
  it('all → своя компания ИЛИ общая очередь (прежнее поведение)', () => {
    expect(dialogWhereForLevel(mgr(), 'all')).toEqual({
      OR: [{ companyId: 'co-1' }, { companyId: null }],
    });
  });

  it('own → свои внутри компании ИЛИ общая очередь', () => {
    expect(dialogWhereForLevel(mgr({ sub: 'u1' }), 'own')).toEqual({
      OR: [{ AND: [{ companyId: 'co-1' }, { assigneeId: 'u1' }] }, { companyId: null }],
    });
  });

  it('assigned → свои ИЛИ переписка закреплённых организаций ИЛИ общая очередь', () => {
    expect(dialogWhereForLevel(mgr({ managedOrgIds: ['o1', 'o2'] }), 'assigned')).toEqual({
      OR: [
        { AND: [{ companyId: 'co-1' }, { assigneeId: 'u1' }] },
        { AND: [{ companyId: 'co-1' }, { organizationId: { in: ['o1', 'o2'] } }] },
        { companyId: null },
      ],
    });
  });

  it('сотрудник без закреплённых организаций на охвате assigned видит только свои', () => {
    // `managedOrgIds: undefined` не должен превратиться в «организация любая»:
    // пустой список — это пустой список, а не снятый фильтр.
    const noOrgs = { sub: 'u1', role: 'manager', companyId: 'co-1' } as unknown as SessionPayload;
    const where = dialogWhereForLevel(noOrgs, 'assigned');
    expect(dialogMatchesWhere(where, MANAGED_ORG)).toBe(false);
    expect(dialogMatchesWhere(where, MINE)).toBe(true);
  });

  it('сессия без компании получает часового, а не пустой фильтр', () => {
    // `companyId: undefined` снял бы условие целиком — и совпал бы со ВСЕМИ
    // компаниями сразу. Часовой не совпадает ни с одной реальной строкой.
    for (const level of ['all', 'own', 'assigned'] as const) {
      const where = dialogWhereForLevel(mgr({ companyId: null }), level);
      expect(JSON.stringify(where)).toContain(NO_COMPANY_SENTINEL);
      expect(dialogMatchesWhere(where, MINE)).toBe(false);
      // Общая очередь при этом остаётся доступной — её разбирают все.
      expect(dialogMatchesWhere(where, UNBOUND)).toBe(true);
    }
  });
});

describe('canSeeDialog() — проверка уже загруженного диалога', () => {
  it('клиентские роли не видят переписку с клиентами никогда', () => {
    for (const role of ['partner', 'organization', 'student'] as const) {
      expect(canSeeDialog({ ...mgr(), role } as unknown as SessionPayload, MINE)).toBe(false);
      // Даже ничейный диалог: общая очередь — внутренний инструмент сотрудников.
      expect(canSeeDialog({ ...mgr(), role } as unknown as SessionPayload, UNBOUND)).toBe(false);
    }
  });

  it('admin видит всё, включая чужую компанию (Model A)', () => {
    const admin = { sub: 'a1', role: 'admin' } as unknown as SessionPayload;
    expect(canSeeDialog(admin, OTHER_COMPANY)).toBe(true);
  });

  it('руководитель — такой же сотрудник контура, охват действует и на него', () => {
    const leader = withLevel('own', { role: 'leader', sub: 'u1' });
    expect(canSeeDialog(leader, MINE)).toBe(true);
    expect(canSeeDialog(leader, COLLEAGUE)).toBe(false);
  });

  it('без профиля доступа — прежнее поведение: вся компания', () => {
    expect(canSeeDialog(mgr(), COLLEAGUE)).toBe(true);
    expect(canSeeDialog(mgr(), OTHER_COMPANY)).toBe(false);
  });

  it('чужая компания закрыта на любом охвате (C8)', () => {
    for (const level of ['all', 'own', 'assigned'] as const) {
      expect(canSeeDialog(withLevel(level), OTHER_COMPANY)).toBe(false);
    }
  });

  it('сессия без компании не видит переписку компаний, но видит общую очередь', () => {
    const homeless = withLevel('all', { companyId: null });
    expect(canSeeDialog(homeless, MINE)).toBe(false);
    expect(canSeeDialog(homeless, UNBOUND)).toBe(true);
  });

  it('ничейный диалог виден на любом охвате — это общая очередь разбора', () => {
    for (const level of ['all', 'own', 'assigned'] as const) {
      expect(canSeeDialog(withLevel(level), UNBOUND)).toBe(true);
    }
  });

  it('assigned: диалог закреплённой организации виден, чужой организации — нет', () => {
    const s = withLevel('assigned', { managedOrgIds: ['o1'] });
    expect(canSeeDialog(s, MANAGED_ORG)).toBe(true);
    expect(canSeeDialog(s, dialog({ assigneeId: 'u2', organizationId: 'o9' }))).toBe(false);
    // Диалог без организации закреплением не покрывается — только «свой».
    expect(canSeeDialog(s, COLLEAGUE)).toBe(false);
  });

  it('assigned без единой закреплённой организации: чужой диалог всё равно закрыт', () => {
    // Сессия вовсе без списка закреплений (поле не пришло) не должна значить
    // «закреплено всё»: пустой список — это пустой список.
    const noOrgs = {
      sub: 'u1',
      role: 'manager',
      companyId: 'co-1',
      accessProfile: profile('assigned'),
    } as unknown as SessionPayload;
    expect(canSeeDialog(noOrgs, MANAGED_ORG)).toBe(false);
    expect(canSeeDialog(noOrgs, MINE)).toBe(true);
  });

  it('own: свой диалог виден, диалог коллеги — нет', () => {
    const s = withLevel('own', { sub: 'u1' });
    expect(canSeeDialog(s, MINE)).toBe(true);
    expect(canSeeDialog(s, COLLEAGUE)).toBe(false);
    // Даже если организация закреплена: охват `own` уже, чем `assigned`.
    expect(canSeeDialog(s, MANAGED_ORG)).toBe(false);
  });
});

/**
 * Главный инвариант модуля: две формы одного правила обязаны означать ОДНО И
 * ТО ЖЕ. Расходятся они молча и самым опасным образом — список показывает
 * диалог, а карточка отвечает «не найдено» (или наоборот: карточка открывает
 * то, чего в списке нет).
 */
describe('условие выборки ↔ проверка строки: одно правило, две записи', () => {
  const ALL_DIALOGS = [MINE, COLLEAGUE, MANAGED_ORG, OTHER_COMPANY, UNBOUND];
  const LEVELS: ScopeLevel[] = ['all', 'assigned', 'own'];

  it.each(LEVELS)('охват «%s» — обе формы отвечают одинаково на всём наборе', (level) => {
    const session = withLevel(level, { sub: 'u1', managedOrgIds: ['o1'] });
    const where = dialogWhereForLevel(session, level);
    for (const row of ALL_DIALOGS) {
      expect(dialogMatchesWhere(where, row), `${level}: ${JSON.stringify(row)}`).toBe(
        canSeeDialog(session, row)
      );
    }
  });

  it('ожидаемая матрица целиком (чтобы «одинаково» не значило «одинаково пусто»)', () => {
    const expected: Record<ScopeLevel, boolean[]> = {
      //          свой,  коллеги, закр. орг, чужая компания, ничейный
      all: [true, true, true, false, true],
      assigned: [true, false, true, false, true],
      own: [true, false, false, false, true],
    };
    for (const level of LEVELS) {
      const session = withLevel(level, { sub: 'u1', managedOrgIds: ['o1'] });
      expect(
        ALL_DIALOGS.map((row) => canSeeDialog(session, row)),
        `охват ${level}`
      ).toEqual(expected[level]);
    }
  });
});
