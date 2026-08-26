import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '__tests__' || e.name === 'node_modules') return [];
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

/**
 * Все чтения переменных окружения по боевому коду `src/**` (кроме
 * `__tests__`): имя переменной → файлы. Общий сбор для стражей `У-122`
 * (реестр env-only) и `У-134` (синхронизация `.env.example`).
 *
 * Ловим четыре паттерна — все, что реально живут в репозитории:
 * 1. буквальное `process.env.X`;
 * 2. `requireEnv('X')` — хелпер `storage/s3.ts`;
 * 3. `env.X` — параметр-объект с дефолтом `= process.env`
 *    (`monitoring/thresholds.ts`) и распарсенная zod-схема (`lib/env.ts`);
 *    первый заход этого сбора паттерна не видел, и пять `ALERT_*`-fallback'ов
 *    были слепой зоной — вскрыто адверсариальным ревью PR-9;
 * 4. ключи объекта zod-схемы `lib/env.ts` (`  DATABASE_URL: …`) — схема
 *    парсит `process.env` целиком, каждое поле = чтение.
 * Мимо остаются только динамические `process.env[expr]` — их имена
 * перечислимы из `SETTING_SPECS[*].envVar` и `FEATURE_FLAGS`, стражи
 * добавляют их сами.
 */
export function collectEnvReads(): Map<string, Set<string>> {
  const reads = new Map<string, Set<string>>();
  const add = (name: string, file: string) => {
    if (!reads.has(name)) reads.set(name, new Set());
    reads.get(name)!.add(file.slice(file.indexOf('src/')));
  };
  for (const file of walk(SRC_ROOT)) {
    const src = readFileSync(file, 'utf-8');
    for (const m of src.matchAll(
      /process\.env\.([A-Z_][A-Za-z0-9_]*)|requireEnv\(\s*'([A-Z_][A-Z0-9_]*)'\s*\)|\benv\.([A-Z_][A-Z0-9_]{2,})\b/g
    )) {
      add((m[1] ?? m[2] ?? m[3])!, file);
    }
    // Ключи zod-схем lib/env.ts: строки вида `    DATABASE_URL: …` внутри
    // z.object({...}). Форма файла стабильна; ложных совпадений не даёт —
    // UPPER_CASE-ключ с двоеточием в src больше нигде не объявляется.
    if (file.endsWith('/lib/env.ts')) {
      for (const m of src.matchAll(/^\s+([A-Z_][A-Z0-9_]{2,}):\s/gm)) {
        add(m[1]!, file);
      }
    }
  }
  return reads;
}
