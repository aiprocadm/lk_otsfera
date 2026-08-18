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
    // '/leader' после снятия лесов (PR-4) — строго ['leader']: переходных
    // токенов с role='manager' у руководителя больше не существует.
    expect(protectedPrefixes).toEqual({
      '/admin': ['admin'],
      '/manager': ['manager', 'leader'],
      '/leader': ['leader'],
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

  it('middleware решает по роли, а не по суб-роли из клейма', () => {
    // До программы дом руководителя вычислялся из клейма managerRole. Теперь
    // роль говорит сама за себя; возврат чтения клейма = возврат старой модели.
    const src = readFileSync(join(SRC, 'middleware.ts'), 'utf8');
    expect(src).toContain("role === 'leader'");
    expect(src, 'middleware снова читает суб-роль из клейма').not.toContain('managerRole');
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
    // PR-2 разобрал контур-выборки в `role: { in: ['manager','leader'] }`,
    // PR-4 перевёл оба воркера на прямой `role: 'leader'`. Остался ОДИН
    // осознанный литерал: manager/invite.ts — data-литерал, приглашение всегда
    // создаёт РЯДОВОГО менеджера (шаблон 2 Р-Л-4), руководителя назначает
    // админ отдельно формой роли.
    const inventory: Record<string, number> = {};
    for (const f of prodFiles()) {
      const n = countMatches(readFileSync(f, 'utf8'), /role: 'manager'/g);
      if (n > 0) inventory[relative(SRC, f).split(sep).join('/')] = n;
    }
    expect(inventory).toEqual({
      'lib/services/manager/invite.ts': 1,
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

// ─── Леса сняты: суб-роль managerRole не может вернуться (PR-4) ──────────────

describe('суб-роль managerRole удалена окончательно', () => {
  /**
   * Главный инвариант финального PR программы: руководитель — top-level роль,
   * а не пометка на менеджере. Пока колонка/клейм существовали, каждое новое
   * правило рисковало снова разъехаться между двумя моделями (ровно из-за
   * этого затевалась программа). Страж ловит возврат ЛЮБОЙ из трёх форм:
   * колонка в схеме, клейм/поле в коде, обращение к нему.
   *
   * Слово `managerRole` в историческом комментарии допустимо — тест смотрит
   * только на код: объявление ключа (`managerRole:`) и обращение (`.managerRole`).
   */
  const CODE_USE = /(^|[^\w.])managerRole\s*[:?]|\.managerRole\b/;

  it('в схеме Prisma нет колонки managerRole', () => {
    const schema = readFileSync(join(SRC, '..', 'prisma', 'schema.prisma'), 'utf8');
    const declared = schema
      .split('\n')
      .filter((l) => /^\s*managerRole\s+/.test(l))
      .map((l) => l.trim());
    expect(declared, 'колонка managerRole вернулась в schema.prisma').toEqual([]);
  });

  it('боевой код нигде не объявляет и не читает managerRole', () => {
    // Единственное исключение — словарь русских подписей журнала аудита:
    // записи AuditLog с полем managerRole остались в базе навсегда, и без
    // подписи журнал показывал бы машинный ключ. Это данные, не модель.
    const ALLOWED = new Set(['lib/audit/labels.ts']);
    const offenders: string[] = [];
    for (const f of prodFiles()) {
      const rel = relative(SRC, f).split(sep).join('/');
      if (ALLOWED.has(rel)) continue;
      const lines = readFileSync(f, 'utf8').split('\n');
      for (const [i, line] of lines.entries()) {
        const t = line.trim();
        // комментарии с историей — не нарушение
        if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
        if (CODE_USE.test(line)) offenders.push(`${relative(SRC, f).split(sep).join('/')}:${i + 1}`);
      }
    }
    expect(offenders, 'суб-роль managerRole вернулась в код').toEqual([]);
  });

  it('isManagerLeader смотрит ровно на роль (без второй половины условия)', () => {
    const src = readFileSync(join(SRC, 'lib', 'auth', 'roleModel.ts'), 'utf8');
    expect(src).toContain("return session.role === 'leader';");
  });
});
