/**
 * Guardrail: матрица «роль × доступ».
 *
 * **Зачем.** Правило доступа пишут «для менеджера» и про руководителя
 * забывают. Так уже было: лидер-инвариант C8 применили к заказам и не
 * применили к организациям — руководитель не мог открыть карточку
 * организации, всплыло только через месяц (PR #273).
 *
 * Тест появился 30.07.2026 как дешёвая замена выделению роли. Роль в итоге
 * выделена программой [ТЗ 2026-08-17](../../docs/tz/2026-08-17-tz-leader-role.md)
 * (руководитель = `role='leader'`, суб-роль `managerRole` снята финальным
 * PR-4), но матрица осталась и продолжает ловить ту же ошибку: теперь она
 * фиксирует ответы предикатов уже для шести полноценных ролей.
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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
      role: 'leader',
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


/** Заказ чужой компании — для проверки, что граница компании держится всегда. */
const FOREIGN_ORDER = { managerId: 'someone', organizationId: 'org-x', companyId: 'co-OTHER' };
/** Заказ своей компании, но не закреплённый за менеджером. */
const COMPANY_ORDER = { managerId: 'someone', organizationId: 'org-9', companyId: COMPANY };

describe('матрица доступа: руководитель против рядового менеджера', () => {
  it('isManagerLeader: только роль leader', () => {
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
    // Список означает ровно то, что в нём написано (мост снят PR-4 —
    // подробности в describe «requireRole больше не мостит…» ниже).
    expect(requireRole(sess('leader'), ['leader']).ok).toBe(true);
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
    expect(isStaffManagerSide(sess('leader'))).toBe(true);
  });

  it('managedOrgIds: пустой скоуп у руководителя — это норма, доступ он получает иначе', () => {
    // Руководитель обычно не закреплён ни за одной организацией: его доступ —
    // company-wide. Если правило смотрит ТОЛЬКО на managedOrgIds, руководитель
    // окажется без доступа — ровно эта ошибка была с карточкой организации.
    expect(managedOrgIds(sess('leader'))).toEqual([]);
  });
});

// ─── Мост снят (PR-4): списки ролей обязаны быть явными ─────────────────────

describe('requireRole больше не мостит руководителя под менеджера', () => {
  /**
   * До PR-4 руководитель проходил по любому списку с 'manager' — переходный
   * мост тянулся с тех пор, когда он БЫЛ менеджером. Мост снят: теперь список
   * ролей означает ровно то, что в нём написано.
   *
   * Обратная сторона: список, который забыли расширить, МОЛЧА отрезает
   * руководителя от раздела (он же больше не manager). Второй тест ниже
   * держит именно это.
   */
  it('список без leader не пускает руководителя, даже если в нём есть manager', () => {
    expect(requireRole(sess('leader'), ['manager']).ok).toBe(false);
    expect(requireRole(sess('leader'), ['admin', 'manager']).ok).toBe(false);
    expect(requireRole(sess('leader'), ['admin', 'manager', 'leader']).ok).toBe(true);
    expect(requireRole(sess('leader'), ['admin']).ok).toBe(false);
    // Рядовой менеджер от расширения списка ничего не получает.
    expect(requireRole(sess('manager'), ['admin', 'manager', 'leader']).ok).toBe(true);
    expect(requireRole(sess('manager'), ['admin', 'leader']).ok).toBe(false);
  });

  it('каждая Prisma-выборка по списку ролей перечисляет leader рядом с manager', () => {
    /**
     * Второй способ молча отрезать руководителя — выборка вида
     * `role: { in: ['admin','manager'] }`. Инвентарь PR-2 смотрел только на
     * литерал `role: 'manager'` и эту форму пропускал; ревизия PR-4 нашла три
     * живых потери: участники события календаря (нельзя было позвать
     * руководителя), список кандидатов в участники и лента исходящих
     * сообщений (ответы руководителя пропадали из инбокса менеджера).
     * Исключение возможно, но объявляется здесь явно — молчаливых нет.
     */
    const ONLY_PLAIN_MANAGER = new Set<string>([
      // выборок «именно рядовой менеджер» по списку сейчас нет
    ]);
    const offenders: string[] = [];
    const srcDir = path.join(process.cwd(), 'src');
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const rel = path.relative(process.cwd(), full);
        if (rel.includes('__tests__')) continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
          const src = readFileSync(full, 'utf8');
          for (const [i, line] of src.split('\n').entries()) {
            const m = /role:\s*\{\s*in:\s*(\[[^\]]*\])/.exec(line);
            if (!m) continue;
            const list = m[1]!;
            if (!list.includes("'manager'") || list.includes("'leader'")) continue;
            const at = `${rel}:${i + 1}`;
            if (!ONLY_PLAIN_MANAGER.has(at)) offenders.push(at);
          }
        }
      }
    };
    walk(srcDir);
    expect(
      offenders,
      'выборка ролей содержит manager без leader — руководитель молча выпадет из списка'
    ).toEqual([]);
  });

  it('каждый staff-вызов requireRole в API перечисляет leader рядом с manager', () => {
    // Инвентарь по исходникам: пропущенный 'leader' = молчаливая потеря
    // доступа руководителя к разделу (симптом «раньше работало»).
    const apiDir = path.join(process.cwd(), 'src', 'app', 'api');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.ts')) {
          const src = readFileSync(full, 'utf8');
          for (const [i, line] of src.split('\n').entries()) {
            const m = /requireRole\([^,]+,\s*(\[[^\]]*\])/.exec(line);
            if (!m) continue;
            const list = m[1]!;
            if (list.includes("'manager'") && !list.includes("'leader'")) {
              offenders.push(`${path.relative(process.cwd(), full)}:${i + 1}`);
            }
          }
        }
      }
    };
    walk(apiDir);
    expect(
      offenders,
      'список ролей содержит manager без leader — руководитель молча потеряет доступ'
    ).toEqual([]);
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
