import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Каждое серверное действие само спрашивает, кто его зовёт.
 *
 * Серверное действие — это HTTP-эндпоинт: Next.js даёт каждому экспорту из
 * файла с `'use server'` свой идентификатор, и он лежит в клиентском бандле.
 * Отправить POST с этим идентификатором может кто угодно и на любой адрес —
 * `middleware.ts` тут не защита: он смотрит на путь страницы, а действие
 * выполняется по идентификатору, а не по тому, чей экран его отрисовал.
 * Значит единственная дверь — гард внутри самого действия (или в сервисе,
 * которому оно передаёт сессию).
 *
 * На 07.09.2026 дверь стоит у всех 189 действий, но держалось это на
 * дисциплине: `server-actions.async-exports` сторожит только ФОРМУ экспорта,
 * и файл без гарда прошёл бы все гейты зелёным (найдено сопровождением
 * `С-4`, хотфикс №15).
 *
 * Признаётся любой из трёх способов — важно, что права спрошены, а не как:
 *  · прямой гард роли или раздела (`requireSession`, `requireManager`,
 *    `requireSettingsSection`, …);
 *  · `getSession()` с явной проверкой результата (личные действия вроде
 *    «выйти со всех устройств» роли не требуют — только «я это я»);
 *  · делегирование в другое действие ЭТОГО ЖЕ файла, у которого гард есть
 *    (тонкие `*FormAction`-обёртки над основным действием).
 */
const ACTIONS_ROOT = join(__dirname, '..', 'server-actions');
const ROOT = join(__dirname, '..', '..');
/** Прямой гард: `requireXxx(` — роль, раздел настроек или просто сессия. */
const DIRECT_GUARD = /\brequire[A-Z]\w*\(/;
/** Личный гард: сессия читается и проверяется тут же. */
const SESSION_GUARD = /\bgetSession\(/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}

type Action = { name: string; body: string };

/** Тела экспортируемых async-функций файла: от заголовка до следующего. */
function actionsOf(src: string): Action[] {
  const heads = [...src.matchAll(/^export async function (\w+)/gm)];
  return heads.map((h, i) => ({
    name: h[1] ?? '',
    body: src.slice(h.index ?? 0, heads[i + 1]?.index ?? src.length),
  }));
}

describe('server-actions: каждое действие спрашивает права само', () => {
  const files = walk(ACTIONS_ROOT).filter((f) => {
    const src = readFileSync(f, 'utf8');
    return src.includes("'use server'") || src.includes('"use server"');
  });

  it('файлы серверных действий находятся — обход не сломан', () => {
    // Страж, которому нечего проверять, зелёный не потому, что всё хорошо.
    expect(files.length).toBeGreaterThan(30);
  });

  it('действий в них достаточно много — разбор тел не развалился', () => {
    const total = files.reduce((n, f) => n + actionsOf(readFileSync(f, 'utf8')).length, 0);
    expect(total).toBeGreaterThan(150);
  });

  it('ни одно действие не выполняется без проверки прав', () => {
    const unguarded: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const actions = actionsOf(src);
      const guarded = new Set(
        actions
          .filter((a) => DIRECT_GUARD.test(a.body) || SESSION_GUARD.test(a.body))
          .map((a) => a.name)
      );
      // Делегирование: обёртка зовёт соседа с гардом. Считаем по кругу, пока
      // множество растёт, — цепочка обёрток может быть длиннее одной.
      for (let grew = true; grew;) {
        grew = false;
        for (const a of actions) {
          if (guarded.has(a.name)) continue;
          const callsGuarded = [...guarded].some((g) =>
            new RegExp(String.raw`\b${g}\s*\(`).test(a.body)
          );
          if (callsGuarded) {
            guarded.add(a.name);
            grew = true;
          }
        }
      }
      for (const a of actions) {
        if (!guarded.has(a.name)) {
          unguarded.push(`${relative(ROOT, file).split(sep).join('/')}::${a.name}`);
        }
      }
    }

    expect(
      unguarded,
      'Серверное действие выполняется без проверки прав. Это открытый ' +
        'HTTP-эндпоинт: идентификатор действия лежит в клиентском бандле, а ' +
        '`middleware.ts` смотрит на путь страницы и такой вызов не остановит. ' +
        'Добавь гард (`requireSession`/`requireManager`/`requireSettingsSection`) ' +
        'или делегируй в действие того же файла, у которого гард есть:\n' +
        unguarded.join('\n')
    ).toEqual([]);
  });

  it('гарды не выдуманы: файлы, на которые ссылается правило, существуют', () => {
    for (const p of [
      'lib/auth/requireRole.ts',
      'lib/auth/requireSettings.ts',
      'lib/auth/session.ts',
    ]) {
      const abs = join(__dirname, '..', p);
      expect(statSync(abs).isFile(), `${p}: файла нет — правило ссылается в пустоту`).toBe(true);
    }
  });
});
