import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { readSource } from './helpers/source';

/**
 * Страж «нет тихих catch» (сопровождение, вопрос `В-1` → решение `Р-25`,
 * 05.09.2026).
 *
 * Прогон №1 нашёл в аудите входа (`recordAudit` в login/2FA/backup-кодах,
 * «выйти везде»), в отметке «последний вход» и в журнале синхронизации Mango
 * обработчик `.catch(() => {})`: запись аудита могла пропасть, и никто бы
 * не узнал. Решение — хелпер `bestEffort(label)` из `@/lib/logging`, который
 * пишет `log.warn(label, err)` и не роняет основное действие.
 *
 * Страж обходит `src/**` (без тестов и e2e) и ищет пустые обработчики:
 * `.catch(() => {})`, `.catch(() => undefined)`, `.catch(function () {})` и
 * пустые блоки `catch {}` / `catch (e) {}` без единого комментария внутри
 * (блок с записанной причиной — осознанное решение, он допустим).
 * Единственные допустимые места для стрелочных форм —
 * `ALLOWED` ниже, с точным числом вхождений и причиной: лишнее или пропавшее
 * вхождение там тоже ловится, чтобы список не устаревал.
 *
 * **`.catch(() => null)` сюда НЕ входит, и это разобрано, а не забыто**
 * (прогон №28). В проекте это устоявшаяся запись «тела запроса нет»:
 * `schema.safeParse(await req.json().catch(() => null))` — двадцать одно
 * место, и в каждом `null` тут же проверяется и превращается в понятный отказ
 * (400 «Invalid request»). Ошибка не проглатывается, а обрабатывается. Если
 * записать этот шаблон в тихие, страж начнёт требовать причину для КОРРЕКТНОГО
 * кода — и список исключений перестанет что-либо значить.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const SKIP_DIRS = new Set(['__tests__', 'e2e']);

/** Файл → сколько тихих catch там допустимо и почему. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  'src/worker/index.ts': {
    count: 2,
    why: 'Sentry.flush перед process.exit: log.error уже записан, процесс завершается — второй warn ничего не добавит',
  },
  'src/lib/services/auth/twoFactor.ts': {
    count: 1,
    why: 'discardTwoFactorChallenge: удаление уже истёкшего челленджа — отказ ожидаемый, не сигнал',
  },
  // Ниже — места с телом-комментарием: раньше страж их не видел вовсе, потому
  // что искал пустой блок по сырому тексту, а комментарий внутри делал блок
  // непустым (прогон №28). Каждое разобрано: это осознанный best-effort, а не
  // забытый обработчик.
  'src/components/notifications/notification-bell.tsx': {
    count: 1,
    why: 'пометка «прочитано» — best-effort: сбой не роняет экран, следующий refetch вернёт прежнее состояние и человек нажмёт снова',
  },
  'src/components/party/inn-duplicate-hint.tsx': {
    count: 1,
    why: 'подсказка о дублях по ИНН информационная: сбой сети не должен мешать заполнять форму, а сообщение об отказе подсказки только отвлекало бы',
  },
  'src/components/settings/company-branding-slots.tsx': {
    count: 1,
    why: 'тело ответа не JSON — код ошибки остаётся `http_<status>` и показывается человеку следующей строкой; это разбор, а не проглатывание',
  },
  'src/components/ui/logout-button.tsx': {
    count: 1,
    why: 'выход: даже если запрос не дошёл, человека уводим на /login — там его встретит middleware; сообщение об ошибке выхода только напугало бы',
  },
  'src/hooks/useStaffChatPolling.ts': {
    count: 1,
    why: 'опрос чата идёт по таймеру: сообщение на каждый неудачный опрос превратилось бы в поток уведомлений, а следующий опрос всё равно догонит',
  },
  'src/hooks/useThreadPolling.ts': {
    count: 1,
    why: 'опрос переписки по таймеру — та же причина, что у чата: следующий опрос догонит, а поток сообщений мешал бы работать',
  },
  'src/instrumentation.ts': {
    count: 1,
    why: 'прайм настроек при старте: база может быть ещё не поднята, и это не повод не стартовать — первый же вход повторит прайм',
  },
  'src/lib/config/integrationSettingsCache.ts': {
    count: 1,
    why: 'расшифровка значения не удалась (сменили мастер-ключ) — работает запасной путь через env; внешний catch того же прайма пишет в журнал',
  },
  'src/lib/services/admin/dashboard.ts': {
    count: 2,
    why: 'плитки «отставание обмена» и «очередь ошибок» гаснут по отдельности, если база или Redis недоступны: сводка администратора обязана открыться целиком (§3, degrade gracefully)',
  },
  'src/lib/ui/useFetchSubmit.ts': {
    count: 2,
    why: 'разбор тела ответа: не JSON или пусто — код ошибки остаётся `http_<status>`, и его показывает вызывающий; это разбор, а не проглатывание',
  },
};

const SILENT_CATCH = [
  /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)/g,
  /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(?:undefined|void 0)\s*\)/g,
  /\.catch\(\s*function\s*\(\s*\w*\s*\)\s*\{\s*\}\s*\)/g,
];
// Пустой блок: имя ошибки может идти с типом (`catch (e: unknown) {}`) или
// вовсе отсутствовать (`catch {}`). Прежний шаблон требовал голое имя и
// пропускал типизированную запись — самую частую в строгом TypeScript.
const EMPTY_BLOCK = /\bcatch\s*(\(\s*\w+(\s*:\s*[\w.<>[\]|\s]+)?\s*\))?\s*\{\s*\}/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...walk(full));
    } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Комментарии не считаются: в них допустимо упоминать старый обработчик. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * Стрелочные `.catch(() => {})` ищутся по коду без комментариев. Пустой блок
 * `catch {}` — по сырому тексту: блок с комментарием внутри («сеть упала —
 * всё равно уходим на /login») не пустой, причина записана, это осознанное
 * решение, а не забытый обработчик.
 */
function countSilent(text: string): number {
  const code = stripComments(text);
  const arrows = SILENT_CATCH.reduce((n, re) => n + (code.match(re)?.length ?? 0), 0);
  // Пустой блок тоже ищем по коду без комментариев: раньше он искался по
  // сырому тексту, и закомментированный `catch {}` в пояснении считался
  // нарушением — ложная тревога, из-за которой в список исключений просились
  // бы правильные файлы (прогон №28).
  return arrows + (code.match(EMPTY_BLOCK)?.length ?? 0);
}

describe('С-8/В-1: тихих `.catch(() => {})` и пустых `catch {}` в src нет', () => {
  const found = new Map<string, number>();
  for (const file of walk(SRC)) {
    const n = countSilent(readSource(file));
    if (n > 0) found.set(path.relative(ROOT, file).split(path.sep).join('/'), n);
  }

  it('вне allow-list тихих обработчиков нет — используй bestEffort(label) из @/lib/logging', () => {
    const offenders = [...found]
      .filter(([file]) => !(file in ALLOWED))
      .map(([file, n]) => `${file} (${n})`);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('allow-list точен: каждое исключение на месте и ровно в том числе', () => {
    const drift = Object.entries(ALLOWED)
      .filter(([file, { count }]) => (found.get(file) ?? 0) !== count)
      .map(([file, { count }]) => `${file}: ожидалось ${count}, найдено ${found.get(file) ?? 0}`);
    expect(drift, drift.join('\n')).toEqual([]);
  });

  it('у каждого исключения записана причина', () => {
    for (const [file, { why }] of Object.entries(ALLOWED)) {
      expect(why.length, file).toBeGreaterThan(20);
    }
  });
});
