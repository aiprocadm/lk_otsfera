import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { readSource } from './helpers/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-199`): URL входящего вебхука Битрикс24 содержит
 * токен портала. В логи, аудит и на экран уходит только домен (`portalHost`).
 * Страж ловит самый вероятный регресс — `log.*(…, { webhookUrl })` или
 * подстановку `webhookUrl` в строку сообщения — во всём `services/bitrix/**`,
 * server actions и процессоре. Проверяется по коду без комментариев
 * (`readSource`), чтобы упоминание в docstring не считалось утечкой.
 */
const ROOT = process.cwd();
const DIRS = ['src/lib/services/bitrix', 'src/server-actions/admin', 'src/worker/processors'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = DIRS.flatMap((d) => {
  const abs = path.join(ROOT, d);
  return statSync(abs).isDirectory() ? walk(abs) : [];
}).filter((f) => /bitrix/i.test(f));

describe('У-199: вебхук Битрикс24 не попадает в логи', () => {
  it('файлы миграции найдены — обход не сломан', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(5);
  });

  it('ни один вызов log.* не получает webhookUrl и не подставляет его в сообщение', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = readSource(file);
      // Любой вызов логгера/консоли, в аргументах которого есть webhookUrl.
      for (const m of src.matchAll(
        /\b(?:log|logger|console|clientLog|edgeLog)\.(?:info|warn|error|debug)\(([\s\S]*?)\);/g
      )) {
        if (/webhookUrl|webhook_url/.test(m[1]!)) {
          offenders.push(`${path.relative(ROOT, file)}: ${m[0].slice(0, 80)}`);
        }
      }
      // Ошибки источника собираются из шаблонных строк — вебхуку там не место.
      for (const m of src.matchAll(/new BitrixSourceError\(([\s\S]*?)\)/g)) {
        if (/webhookUrl|base\b/.test(m[1]!)) {
          offenders.push(`${path.relative(ROOT, file)}: ${m[0].slice(0, 80)}`);
        }
      }
    }
    expect(offenders, 'URL вебхука (с токеном) уходит в лог или в текст ошибки:\n').toEqual([]);
  });
});
