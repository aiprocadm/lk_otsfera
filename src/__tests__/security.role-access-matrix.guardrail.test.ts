/**
 * Guardrail: матрица «роль × доступ».
 *
 * **Зачем.** Руководитель — не отдельная роль, а суб-роль менеджера
 * (`role='manager'` + `managerRole='leader'`, §4 CLAUDE.md). Из-за этого новое
 * правило доступа пишут «для менеджера» и про руководителя забывают. Так уже
 * было: лидер-инвариант C8 применили к заказам и не применили к организациям —
 * руководитель не мог открыть карточку организации, всплыло только через месяц
 * (PR #273).
 *
 * Заказчик 30.07.2026 рассмотрел выделение полноценной роли
 * ([спека](../../docs/superpowers/specs/2026-07-30-leader-role-extraction-design.md))
 * и выбрал вместо неё **этот тест** — дешёвую защиту от той же ошибки.
 *
 * **Что он делает.**
 *   1. Держит ЯВНУЮ таблицу: какой предикат доступа что отвечает каждой роли,
 *      включая руководителя. Поменялось поведение — тест краснеет.
 *   2. **Ловит появление нового предиката**: если в `managerPolicy.ts` или в
 *      гардах появилась экспортируемая проверка, не описанная в таблице, тест
 *      падает с требованием решить, что она отвечает руководителю. Забыть
 *      физически нельзя.
 *
 * Тест намеренно unit-уровня: он про правила, а не про данные.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  canSeeOrder,
  canSeeDocument,
  canSeeOrganization,
  isManagerLeader,
  isStaffManagerSide,
  isLeaderSameCompany,
  managedOrgIds,
  mayImportOneC,
} from '@/lib/auth/managerPolicy';
import { requireFieldsAdmin, requireAdmin, requireRole } from '@/lib/auth/guard';

// ─── Роли, которые обязана различать система ────────────────────────────────

type RoleKey = 'admin' | 'leader' | 'manager' | 'partner' | 'organization' | 'student';

const COMPANY = 'co-1';
const ORG = 'org-1';

function sess(role: RoleKey, over: Partial<SessionPayload> = {}): SessionPayload {
  const base: Partial<SessionPayload> = { sub: `u-${role}`, companyId: COMPANY };
  if (role === 'leader') {
    return {
      ...base,
      role: 'manager',
      managerRole: 'leader',
      managedOrgIds: [],
      ...over,
    } as SessionPayload;
  }
  if (role === 'manager') {
    return { ...base, role: 'manager', managedOrgIds: [], ...over } as SessionPayload;
  }
  return { ...base, role, ...over } as SessionPayload;
}

const ALL_ROLES: RoleKey[] = ['admin', 'leader', 'manager', 'partner', 'organization', 'student'];

/**
 * ВТОРАЯ модель руководителя (ТЗ 2026-08-17, Р-Л-1): top-level роль `leader`.
 * До PR-3 токенов с ней не существует, но инфраструктура PR-1 обязана отвечать
 * ей так же, как старой паре — эквивалентность держит describe ниже.
 */
function newLeaderSess(over: Partial<SessionPayload> = {}): SessionPayload {
  return {
    sub: 'u-leader-new',
    companyId: COMPANY,
    role: 'leader',
    managedOrgIds: [],
    ...over,
  } as SessionPayload;
}

/** Заказ чужой компании — для проверки, что граница компании держится всегда. */
const FOREIGN_ORDER = { managerId: 'someone', organizationId: 'org-x', companyId: 'co-OTHER' };
/** Заказ своей компании, но не закреплённый за менеджером. */
const COMPANY_ORDER = { managerId: 'someone', organizationId: 'org-9', companyId: COMPANY };

describe('матрица доступа: руководитель против рядового менеджера', () => {
  it('isManagerLeader: только суб-роль leader', () => {
    const actual = Object.fromEntries(ALL_ROLES.map((r) => [r, isManagerLeader(sess(r))]));
    expect(actual).toEqual({
      admin: false,
      leader: true,
      manager: false,
      partner: false,
      organization: false,
      student: false,
    });
  });

  // Решение заказчика 11.08.2026 ОТМЕНИЛО прежнее правило `Т-25` («только
  // админ и руководитель»). Менеджер импортирует, но границу держит скоуп:
  // свои организации и запрет создавать новые (см. importScope и writers).
  it('mayImportOneC (импорт из 1С): весь штат — админ, руководитель и менеджер; клиенты — нет', () => {
    const actual = Object.fromEntries(ALL_ROLES.map((r) => [r, mayImportOneC(sess(r))]));
    expect(actual).toEqual({
      admin: true,
      leader: true,
      manager: true,
      partner: false,
      organization: false,
      student: false,
    });
    // Право не зависит от companyId: руководитель без компании остаётся
    // руководителем (скоуп при этом деградирует в orgs — см. importScope).
    expect(mayImportOneC(sess('leader', { companyId: null } as never))).toBe(true);
  });

  it('requireFieldsAdmin (настройка полей и статусов, §4 ТЗ): админ и руководитель', () => {
    const actual = Object.fromEntries(ALL_ROLES.map((r) => [r, requireFieldsAdmin(sess(r)).ok]));
    expect(actual).toEqual({
      admin: true,
      leader: true,
      manager: false,
      partner: false,
      organization: false,
      student: false,
    });
  });

  it('requireAdmin: только админ — руководитель НЕ администратор', () => {
    const actual = Object.fromEntries(ALL_ROLES.map((r) => [r, requireAdmin(sess(r)).ok]));
    expect(actual).toEqual({
      admin: true,
      leader: false,
      manager: false,
      partner: false,
      organization: false,
      student: false,
    });
  });

  it('isLeaderSameCompany: руководитель — только своя компания', () => {
    expect(isLeaderSameCompany(sess('leader'), COMPANY)).toBe(true);
    expect(isLeaderSameCompany(sess('leader'), 'co-OTHER')).toBe(false);
    expect(isLeaderSameCompany(sess('manager'), COMPANY)).toBe(false);
    // Руководитель без компании в сессии — отказ (fail-safe).
    expect(isLeaderSameCompany(sess('leader', { companyId: null }), COMPANY)).toBe(false);
  });

  it('canSeeOrder: заказ своей компании — руководителю да, рядовому менеджеру нет', () => {
    // Лидер-инвариант живёт в вызывающем коде (isLeaderSameCompany ||
    // canSeeOrder), поэтому здесь фиксируем сам canSeeOrder: он про скоуп.
    expect(canSeeOrder(sess('manager'), COMPANY_ORDER, false)).toBe(false);
    expect(isLeaderSameCompany(sess('leader'), COMPANY_ORDER.companyId)).toBe(true);
  });

  it('граница компании держится для всех, включая руководителя', () => {
    expect(isLeaderSameCompany(sess('leader'), FOREIGN_ORDER.companyId)).toBe(false);
    expect(canSeeOrder(sess('manager'), FOREIGN_ORDER, true)).toBe(false);
    expect(canSeeOrder(sess('leader'), FOREIGN_ORDER, true)).toBe(false);
  });

  it('canSeeOrganization / canSeeDocument: клиентские роли не проходят', () => {
    for (const role of ['partner', 'organization', 'student'] as RoleKey[]) {
      expect(canSeeOrganization(sess(role), ORG)).toBe(false);
      expect(canSeeDocument(sess(role), { order: COMPANY_ORDER }, false)).toBe(false);
    }
  });

  it('requireRole со списком ролей не пускает руководителя туда, где ждут админа', () => {
    expect(requireRole(sess('leader'), ['admin']).ok).toBe(false);
    expect(requireRole(sess('leader'), ['manager']).ok).toBe(true); // leader = manager по JWT
    expect(requireRole(sess('manager'), ['manager']).ok).toBe(true);
  });

  it('isStaffManagerSide (Р-Л-4, шаблон «контур»): менеджер и руководитель — да, прочие — нет', () => {
    const actual = Object.fromEntries(ALL_ROLES.map((r) => [r, isStaffManagerSide(sess(r))]));
    expect(actual).toEqual({
      admin: false,
      leader: true,
      manager: true,
      partner: false,
      organization: false,
      student: false,
    });
    expect(isStaffManagerSide(newLeaderSess())).toBe(true);
  });

  it('managedOrgIds: пустой скоуп у руководителя — это норма, доступ он получает иначе', () => {
    // Руководитель обычно не закреплён ни за одной организацией: его доступ —
    // company-wide. Если правило смотрит ТОЛЬКО на managedOrgIds, руководитель
    // окажется без доступа — ровно эта ошибка была с карточкой организации.
    expect(managedOrgIds(sess('leader'))).toEqual([]);
  });
});

// ─── Переходный период (ТЗ 2026-08-17): обе модели руководителя эквивалентны ─

describe('обе модели руководителя дают одинаковые ответы (PR-1)', () => {
  // Пока разобранные PR-1 предикаты; PR-2 доводит список до всех мест
  // «это менеджер?» (инвентарь — security.role-model-inventory.guardrail).
  it('isManagerLeader / isStaffManagerSide / requireFieldsAdmin / mayImportOneC', () => {
    const oldModel = sess('leader');
    const newModel = newLeaderSess();
    expect(isManagerLeader(newModel)).toBe(isManagerLeader(oldModel));
    expect(isStaffManagerSide(newModel)).toBe(isStaffManagerSide(oldModel));
    expect(requireFieldsAdmin(newModel).ok).toBe(requireFieldsAdmin(oldModel).ok);
    expect(mayImportOneC(newModel)).toBe(mayImportOneC(oldModel));
  });

  it('isLeaderSameCompany: граница компании одинакова в обеих моделях', () => {
    expect(isLeaderSameCompany(newLeaderSess(), COMPANY)).toBe(true);
    expect(isLeaderSameCompany(newLeaderSess(), 'co-OTHER')).toBe(false);
    expect(isLeaderSameCompany(newLeaderSess({ companyId: null } as never), COMPANY)).toBe(false);
  });

  it('requireRole-мост: роль leader проходит по спискам с manager, но не к админу', () => {
    // 14 API-списков вида ['admin','manager'] исторически пускали руководителя
    // (он был manager); мост сохраняет это до разбора в PR-2, снимается PR-4.
    expect(requireRole(newLeaderSess(), ['manager']).ok).toBe(true);
    expect(requireRole(newLeaderSess(), ['admin', 'manager']).ok).toBe(true);
    expect(requireRole(newLeaderSess(), ['admin']).ok).toBe(false);
    expect(requireRole(newLeaderSess(), ['partner']).ok).toBe(false);
  });
});

// ─── Автоконтроль полноты: новый предикат нельзя не заметить ────────────────

describe('полнота матрицы', () => {
  /**
   * Предикаты доступа, поведение которых для руководителя ОПИСАНО выше или
   * сознательно не требует различия ролей. Появился новый экспорт — тест
   * упадёт, и придётся дописать сюда строку, ответив на вопрос
   * «а что он отвечает руководителю?».
   */
  const DESCRIBED = new Set([
    // разобраны в матрице выше
    'canSeeOrder',
    'canSeeDocument',
    'canSeeOrganization',
    'isManagerLeader',
    'isStaffManagerSide',
    'isLeaderSameCompany',
    'managedOrgIds',
    'mayImportOneC',
    // Скоуп-фильтры Prisma: роль в них не участвует напрямую, различие
    // приходит параметром teamMode/профилем — проверяется своими тестами
    // (auth.managerPolicy.test.ts, auth.managerPolicy.profile.unit.test.ts).
    'managerOrderScopeFilter',
    'managerDocumentScopeFilter',
    'managerOrgScopeFilter',
    'companyWideOrderFilter',
    'managerOrderScope',
    'managerDocumentScope',
    'managerOrgScope',
    // Настройка компании, не роль.
    'getCompanyTeamVisibility',
    // Разобран в auth.managerPolicy.canManagerAccessOrg.test.ts, включая
    // лидер-инвариант (решение заказчика 29.07.2026).
    'canManagerAccessOrg',
    // Алиас canSeeOrganization.
    'isOrgInScope',
  ]);

  function exportedNames(relPath: string): string[] {
    const src = readFileSync(path.join(process.cwd(), relPath), 'utf8');
    const names: string[] = [];
    const re = /^export (?:async )?(?:function|const) (\w+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) names.push(m[1]);
    return names;
  }

  it('каждый предикат managerPolicy описан в матрице', () => {
    const missing = exportedNames('src/lib/auth/managerPolicy.ts').filter((n) => !DESCRIBED.has(n));
    expect(
      missing,
      `Появились новые предикаты доступа: ${missing.join(', ')}. ` +
        'Допишите их в матрицу security.role-access-matrix и ответьте на вопрос: ' +
        'что этот предикат отвечает РУКОВОДИТЕЛЮ? Именно про него забывают.'
    ).toEqual([]);
  });

  const DESCRIBED_GUARDS = new Set([
    'requireAdmin',
    'requireFieldsAdmin',
    'requireRole',
    // Не про различие менеджер/руководитель:
    'requireSession',
    'requireOrderAccess',
    'requirePartner',
    'requirePartnerAdmin',
    'unauthorizedResponse',
    'forbiddenResponse',
  ]);

  it('каждый гард API описан в матрице', () => {
    const missing = exportedNames('src/lib/auth/guard.ts').filter((n) => !DESCRIBED_GUARDS.has(n));
    expect(
      missing,
      `Появились новые гарды: ${missing.join(', ')}. ` +
        'Допишите их в матрицу и решите, проходит ли туда руководитель.'
    ).toEqual([]);
  });

  const DESCRIBED_PAGE_GUARDS = new Set([
    'requireSession',
    'requireAdmin',
    'requirePartner',
    'requirePartnerAdmin',
    'requireOrganization',
    'requireOrganizationAdmin',
    'requireOrganizationAdminOrLeader',
    // Менеджерский контур: руководитель проходит оба (играющий тренер).
    'requireManager',
    'requireManagerForOrg',
    'requireManagerForOrder',
    // Только руководитель.
    'requireManagerLeader',
  ]);

  it('каждый страничный гард описан в матрице', () => {
    const missing = exportedNames('src/lib/auth/requireRole.ts').filter(
      (n) => !DESCRIBED_PAGE_GUARDS.has(n)
    );
    expect(
      missing,
      `Появились новые страничные гарды: ${missing.join(', ')}. ` +
        'Допишите их в матрицу: пускают ли они руководителя?'
    ).toEqual([]);
  });
});
