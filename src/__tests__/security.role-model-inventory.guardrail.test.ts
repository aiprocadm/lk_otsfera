import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { roleHome, protectedPrefixes } from '@/lib/auth/access';
import { navByRole } from '@/lib/navigation/cabinet';
import { MOBILE_TABS } from '@/lib/navigation/mobileTabs';

const SRC = join(__dirname, '..');

// Локальная копия ROLE_VALUES (сам массив в jwt.ts намеренно не экспортируется,
// §12b); совпадение с исходником держит первый тест ниже — разъехаться молча
// они не могут.
const CURRENT_ROLES = ['admin', 'manager', 'partner', 'organization', 'student'] as const;

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
  it('ROLE_VALUES: ровно пять ролей; добавляя шестую — пройди весь этот файл', () => {
    // Это «главный рубильник» инвентаря: PR-1 добавит 'leader' и обязан
    // осознанно обновить каждый снимок ниже решением, а не автозаменой.
    const jwt = readFileSync(join(SRC, 'lib', 'auth', 'jwt.ts'), 'utf8');
    expect(jwt).toContain(
      `const ROLE_VALUES = [${CURRENT_ROLES.map((r) => `'${r}'`).join(', ')}] as const;`
    );
  });

  it('protectedPrefixes: точный снимок «префикс → роли»', () => {
    // Р-Л-3: после выделения роли '/manager' обязан пускать ['manager','leader']
    // («играющий тренер»), '/leader' — ['leader']. Пока модель старая —
    // фиксируем сегодняшнее состояние, чтобы смена была явной.
    expect(protectedPrefixes).toEqual({
      '/admin': ['admin'],
      '/manager': ['manager'],
      '/leader': ['manager'],
      '/partner': ['partner'],
      '/organization': ['organization'],
      '/student': ['student', 'organization', 'admin', 'manager'],
    });
  });

  it('roleHome: дом задан каждой роли', () => {
    expect(Object.keys(roleHome).sort()).toEqual([...CURRENT_ROLES].sort());
  });

  it('navByRole и MOBILE_TABS: ключи = роли + канонический ключ leader', () => {
    const expected = [...CURRENT_ROLES, 'leader'].sort();
    expect(Object.keys(navByRole).sort()).toEqual(expected);
    expect(Object.keys(MOBILE_TABS).sort()).toEqual(expected);
  });

  it('middleware вычисляет isLeader из клейма managerRole (уйдёт в PR-1)', () => {
    const src = readFileSync(join(SRC, 'middleware.ts'), 'utf8');
    expect(src).toContain(".managerRole === 'leader'");
  });

  it('buildSessionClaims: менеджерская ветка одна; leader-ветки нет (появится в PR-1)', () => {
    // Без ветки для новой роли лидер не получит managedOrgIds/accessProfile,
    // и requireManager() выбросит его на /login. Снимок заставит PR-1 решить.
    const src = readFileSync(join(SRC, 'lib', 'auth', 'buildSessionClaims.ts'), 'utf8');
    expect(countMatches(src, /user\.role === 'manager'/g)).toBe(1);
    expect(src).not.toContain("user.role === 'leader'");
  });

  it('словари-типы без leader: NotificationRole и QuickTasksRole', () => {
    // NotificationRole без leader = deep-link'и уведомлений руководителя
    // станут null; QuickTasksRole уже несёт 'leader' как НЕ-JWT ключ.
    const href = readFileSync(join(SRC, 'lib', 'notifications', 'href.ts'), 'utf8');
    expect(href).toContain(
      "export type NotificationRole = 'admin' | 'manager' | 'partner' | 'organization'"
    );
    const quick = readFileSync(join(SRC, 'lib', 'quickTasks.ts'), 'utf8');
    expect(quick).toContain(
      "export type QuickTasksRole = 'admin' | 'manager' | 'leader' | 'partner' | 'organization'"
    );
  });
});

describe('инвентарь «это менеджер?» — по файлам (Р-Л-4)', () => {
  it("Prisma-литералы role: 'manager' — точный инвентарь", () => {
    // Эти выборки при смене модели МОЛЧА перестанут находить руководителей:
    // воркеры SLA/сертификатов, @-упоминания, ростер, кандидаты назначения,
    // уведомления. PR-2 разбирает каждую по трём шаблонам Р-Л-4.
    const inventory: Record<string, number> = {};
    for (const f of prodFiles()) {
      const n = countMatches(readFileSync(f, 'utf8'), /role: 'manager'/g);
      if (n > 0) inventory[relative(SRC, f).split(sep).join('/')] = n;
    }
    expect(inventory).toEqual({
      'lib/notifications/manager.ts': 2,
      'lib/services/access/profiles.ts': 1,
      'lib/services/admin/users/queries.ts': 2,
      'lib/services/clientRequests/notify.ts': 1,
      'lib/services/manager/invite.ts': 1,
      'lib/services/manager/team.ts': 1,
      'lib/services/staffChat/mentions.ts': 1,
      'lib/services/tasks/board.ts': 1,
      'worker/processors/certificate-expiry.ts': 1,
      'worker/processors/sla-escalation.ts': 1,
    });
  });

  it("staff-идиома `admin || manager` — точный инвентарь", () => {
    // Каждая из этих проверок при выделении роли МОЛЧА выключит руководителя
    // из staff-контура (сделки, задачи, календарь, чаты, статусы, ПДн-журнал).
    const RE = /role === 'admin' \|\| [a-zA-Z.]*role === 'manager'|role === 'manager' \|\| [a-zA-Z.]*role === 'admin'/g;
    const inventory: Record<string, number> = {};
    for (const f of prodFiles()) {
      const n = countMatches(readFileSync(f, 'utf8'), RE);
      if (n > 0) inventory[relative(SRC, f).split(sep).join('/')] = n;
    }
    expect(inventory).toEqual({
      'app/admin/users/[id]/page.tsx': 1,
      'app/api/auth/login/route.ts': 1,
      'lib/auth/managerPolicy.ts': 1,
      'lib/pii/record.ts': 1,
      'lib/services/calendar/events.ts': 1,
      'lib/services/calendar/items.ts': 1,
      'lib/services/chat/messages.ts': 1,
      'lib/services/clientRequests/policy.ts': 1,
      'lib/services/deals/board.ts': 1,
      'lib/services/deals/convert.ts': 1,
      'lib/services/deals/crud.ts': 1,
      'lib/services/deals/notes.ts': 1,
      'lib/services/enrollments/policy.ts': 2,
      'lib/services/funnel/board.ts': 1,
      'lib/services/import/oneCAccountCard/resolve-picker.ts': 1,
      'lib/services/import/oneCAccountCard/resolve-queue.ts': 1,
      'lib/services/intake/convert.ts': 1,
      'lib/services/leader/analytics.ts': 1,
      'lib/services/orderStatuses/panel.ts': 1,
      'lib/services/orderStatuses/transitions.ts': 1,
      'lib/services/search/globalSearch.ts': 1,
      'lib/services/staffChat/conversations.ts': 1,
      'lib/services/staffChat/policy.ts': 1,
      'lib/services/tasks/board.ts': 1,
      'lib/services/tasks/tasks.ts': 1,
      'lib/services/training/certificates.ts': 1,
      'lib/services/training/orderItems.ts': 1,
      'server-actions/staff/backupCodes.ts': 1,
    });
  });
});
