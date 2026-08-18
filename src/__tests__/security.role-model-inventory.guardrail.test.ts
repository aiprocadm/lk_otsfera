import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { roleHome, protectedPrefixes } from '@/lib/auth/access';
import { navByRole } from '@/lib/navigation/cabinet';
import { MOBILE_TABS } from '@/lib/navigation/mobileTabs';

const SRC = join(__dirname, '..');

// Локальная копия ROLE_VALUES (сам массив в jwt.ts намеренно не экспортируется,
// §12b); совпадение с исходником держит первый тест ниже — разъехаться молча
// они не могут. `leader` добавлен PR-1 (Р-Л-1) — снимки ниже обновлены
// решениями Р-Л-2/Р-Л-3, а не автозаменой.
const CURRENT_ROLES = ['admin', 'manager', 'leader', 'partner', 'organization', 'student'] as const;

/**
 * PR-0 программы «роль Руководитель» (ТЗ 2026-08-17-tz-leader-role, Р-Л-5):
 * инвентарь мест, которые при добавлении значения в `Role` ломаются МОЛЧА —
 * типы их не поймают, а поведение просто перекосится (менеджер получит
 * лишнее или руководитель потеряет нужное).
 *
 * Как это работает: тест фиксирует точный снимок ролевой модели. Добавление
 * роли `leader` (PR-1) уронит снимки — и КАЖДОЕ падение здесь означает
 * конкретное решение из таблицы §2 ТЗ, которое обязан принять PR-1/PR-2.
 * Обновлять снимок можно только вместе с самим решением, а не «чтобы стало
 * зелёным».
 *
 * Инвентари по файлам (не по номерам строк — те хрупкие): изменилось число
 * вхождений — значит появилось/исчезло место «это менеджер?», и его надо
 * внести в разбор по трём шаблонам (Р-Л-4).
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function prodFiles(): string[] {
  return walk(SRC).filter((f) => {
    const rel = relative(SRC, f);
    return !rel.startsWith(`__tests__${sep}`) && !rel.startsWith(`e2e${sep}`);
  });
}

function countMatches(src: string, re: RegExp): number {
  return src.match(re)?.length ?? 0;
}

describe('ролевая модель — снимок (PR-0 «шумящие стражи»)', () => {
  it('ROLE_VALUES: ровно шесть ролей; добавляя новую — пройди весь этот файл', () => {
    // «Главный рубильник» инвентаря: любое изменение набора ролей обязано
    // осознанно обновить каждый снимок ниже решением, а не автозаменой.
    const jwt = readFileSync(join(SRC, 'lib', 'auth', 'jwt.ts'), 'utf8');
    expect(jwt).toContain(
      `const ROLE_VALUES = [${CURRENT_ROLES.map((r) => `'${r}'`).join(', ')}] as const;`
    );
  });

  it('protectedPrefixes: точный снимок «префикс → роли»', () => {
    // Р-Л-3 («играющий тренер»): '/manager' пускает обе роли контура.
    // '/leader' до PR-4 тоже обе: старые токены руководителя несут 'manager'
    // (суб-роль бьёт серверный гард layout). PR-4 сузит '/leader' до ['leader'].
    expect(protectedPrefixes).toEqual({
      '/admin': ['admin'],
      '/manager': ['manager', 'leader'],
      '/leader': ['manager', 'leader'],
      '/partner': ['partner'],
      '/organization': ['organization'],
      '/student': ['student', 'organization', 'admin', 'manager', 'leader'],
    });
  });

  it('roleHome: дом задан каждой роли', () => {
    expect(Object.keys(roleHome).sort()).toEqual([...CURRENT_ROLES].sort());
  });

  it('navByRole и MOBILE_TABS: ключи = все роли (leader теперь настоящая)', () => {
    // До PR-1 'leader' был НЕ-JWT ключом канона меню; теперь это роль из
    // ROLE_VALUES, и наборы совпадают один в один.
    const expected = [...CURRENT_ROLES].sort();
    expect(Object.keys(navByRole).sort()).toEqual(expected);
    expect(Object.keys(MOBILE_TABS).sort()).toEqual(expected);
  });

  it('middleware понимает ОБЕ модели руководителя (вторая половина уйдёт в PR-4)', () => {
    const src = readFileSync(join(SRC, 'middleware.ts'), 'utf8');
    expect(src).toContain("role === 'leader' ||");
    // Переходная пара: старые токены живут 7 дней после миграции данных (PR-3).
    expect(src).toContain(".managerRole === 'leader'");
  });

  it('buildSessionClaims: контур менеджера — одна ветка на обе роли', () => {
    // Без ветки для роли leader лидер не получил бы managedOrgIds/accessProfile,
    // и requireManager() выбросил бы его на /login.
    const src = readFileSync(join(SRC, 'lib', 'auth', 'buildSessionClaims.ts'), 'utf8');
    expect(src).toContain("user.role === 'manager' || user.role === 'leader'");
  });

  it('словари-типы знают leader: NotificationRole и QuickTasksRole', () => {
    // PR-2: NotificationRole расширен — иначе deep-link'и уведомлений
    // руководителя стали бы null после миграции данных (PR-3).
    const href = readFileSync(join(SRC, 'lib', 'notifications', 'href.ts'), 'utf8');
    expect(href).toContain(
      "export type NotificationRole = 'admin' | 'manager' | 'leader' | 'partner' | 'organization'"
    );
    const quick = readFileSync(join(SRC, 'lib', 'quickTasks.ts'), 'utf8');
    expect(quick).toContain(
      "export type QuickTasksRole = 'admin' | 'manager' | 'leader' | 'partner' | 'organization'"
    );
  });
});

describe('инвентарь «это менеджер?» — по файлам (Р-Л-4)', () => {
  it("Prisma-литералы role: 'manager' — точный инвентарь", () => {
    // PR-2 разобрал контур-выборки в `role: { in: ['manager','leader'] }`.
    // Осталось три ОСОЗНАННЫХ литерала:
    //  - manager/invite.ts — data-литерал: приглашение всегда создаёт РЯДОВОГО
    //    менеджера (шаблон 2 Р-Л-4), руководителя назначает админ отдельно;
    //  - оба воркера — литерал живёт ВНУТРИ OR обеих моделей руководителя
    //    ({role:'leader'} ∨ {role:'manager', managerRole:'leader'}); вторая
    //    половина снимается PR-4 вместе с колонкой managerRole.
    const inventory: Record<string, number> = {};
    for (const f of prodFiles()) {
      const n = countMatches(readFileSync(f, 'utf8'), /role: 'manager'/g);
      if (n > 0) inventory[relative(SRC, f).split(sep).join('/')] = n;
    }
    expect(inventory).toEqual({
      'lib/services/manager/invite.ts': 1,
      'worker/processors/certificate-expiry.ts': 1,
      'worker/processors/sla-escalation.ts': 1,
    });
  });

  it("staff-идиома `admin || manager` — точный инвентарь", () => {
    // PR-2 разобрал сессионные идиомы через isStaffManagerSide. Остались три
    // ОСОЗНАННЫЕ — все про БД-роль (user/target, не SessionPayload), все уже
    // расширены третьим слагаемым `|| role === 'leader'` (регэксп ловит первые
    // два): staff-гейт 2FA при логине, staff-секция кодов восстановления в
    // админ-карточке и цель staff-диалога в служебном чате.
    const RE = /role === 'admin' \|\| [a-zA-Z.]*role === 'manager'|role === 'manager' \|\| [a-zA-Z.]*role === 'admin'/g;
    const inventory: Record<string, number> = {};
    for (const f of prodFiles()) {
      const n = countMatches(readFileSync(f, 'utf8'), RE);
      if (n > 0) inventory[relative(SRC, f).split(sep).join('/')] = n;
    }
    expect(inventory).toEqual({
      'app/admin/users/[id]/page.tsx': 1,
      'app/api/auth/login/route.ts': 1,
      'lib/services/staffChat/conversations.ts': 1,
    });
    // Каждое место обязано включать третье слагаемое — leader тоже staff.
    for (const rel of [
      'app/admin/users/[id]/page.tsx',
      'app/api/auth/login/route.ts',
      'lib/services/staffChat/conversations.ts',
    ]) {
      const src = readFileSync(join(SRC, ...rel.split('/')), 'utf8');
      expect(src, `${rel}: staff-условие обязано включать 'leader'`).toContain(
        "role === 'leader'"
      );
    }
  });
});
