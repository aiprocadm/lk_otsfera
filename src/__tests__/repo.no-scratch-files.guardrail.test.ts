import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Под контролем версий не должно быть **черновиков** — временных файлов,
 * которые агент или человек создаёт на один прогон.
 *
 * **Как это случилось.** Прогон сопровождения №31: я писал одноразовые
 * скрипты-помощники в `scripts/.tmp-*.py`, чтобы не втискивать многострочный
 * код в командную строку, и удалял их сразу после запуска. Один раз команда
 * «запустить и удалить» оборвалась на середине (сработала проверка внутри
 * скрипта), файл остался — а следующий коммит собирался через `git add -A` и
 * увёз его в `main`. Заметил только при уборке перед закрытием сессии.
 *
 * Ничего не ломается: черновик просто лежит в `scripts/` и выглядит как часть
 * проекта. Ровно так же незаметно приезжали лог-файлы (`Д-41`) — и этот страж
 * сделан по образцу [repo.no-log-files](repo.no-log-files.guardrail.test.ts):
 * смотрит **индекс git**, а не текст `.gitignore`, потому что правило в
 * `.gitignore` можно случайно ослабить, а индекс — единственный источник
 * правды о том, что реально под версиями.
 *
 * **Что считается черновиком.** Имя, начинающееся с `.tmp` или содержащее
 * `tmp-`/`-tmp`, а также `*.bak`, `*.orig`, `*.rej`. Это не «временные файлы
 * вообще» (у сборки свои каталоги, они в `.gitignore`), а именно рукописные
 * одноразовые помощники и следы правок.
 *
 * **Исключений нет намеренно.** Черновик воспроизводится тем, кто его писал,
 * за минуту; хранить его рядом с кодом незачем, а лежащий в репозитории он
 * вводит в заблуждение следующего читателя.
 */
const REPO_ROOT = join(__dirname, '..', '..');

/** Список путей под git. Работает и в worktree: `.git` там файл-указатель. */
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter((p) => p.length > 0);
}

/** Похоже ли имя файла на одноразовый черновик. */
export function looksLikeScratch(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  if (/^\.tmp/.test(name)) return true;
  if (/(^|[._-])tmp-/.test(name)) return true;
  if (/-tmp(\.|$)/.test(name)) return true;
  return /\.(bak|orig|rej)$/.test(name);
}

describe('под git нет черновиков и следов правок', () => {
  it('шаблон узнаёт черновики и не трогает настоящие файлы', () => {
    // Без этой проверки легко написать выражение, которое не совпадёт ни с
    // чем и будет вечно зелёным — тем самым «молчащим стражем», против
    // которого написано правило мутации (§16).
    expect(looksLikeScratch('scripts/.tmp-j31.py')).toBe(true);
    expect(looksLikeScratch('scripts/.tmp-reshoot.sh')).toBe(true);
    expect(looksLikeScratch('src/lib/foo.ts.bak')).toBe(true);
    expect(looksLikeScratch('docs/plan.md.orig')).toBe(true);
    expect(looksLikeScratch('scripts/tmp-fix.ts')).toBe(true);

    expect(looksLikeScratch('scripts/build.ts')).toBe(false);
    expect(looksLikeScratch('src/lib/services/import/temporary.ts')).toBe(false);
    expect(looksLikeScratch('src/components/ui/dialog.tsx')).toBe(false);
  });

  it('ни одного черновика не лежит под контролем версий', () => {
    const scratch = trackedFiles().filter(looksLikeScratch);
    expect(
      scratch,
      'Эти файлы похожи на одноразовые черновики и не должны быть под git:\n' +
        scratch.map((p) => `  ${p}`).join('\n') +
        '\n\nУдалите их из индекса (`git rm`). Если файл нужен проекту — дайте ему\n' +
        'обычное имя и опишите назначение в шапке, как это сделано у scripts/gate.ts.'
    ).toEqual([]);
  });
});
