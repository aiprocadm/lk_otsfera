import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { readSource } from './helpers/source';

/**
 * Этап 2 ТЗ 12.09.2026, спека §1: пакет `xlsx` (SheetJS) несёт уязвимость без
 * фикса (`Д-49` → `У-267`, этап 9). Старые читатели импорта 1С его ещё
 * держат, а новый код миграции из Битрикс24 обязан читать книги и CSV через
 * `exceljs`. Страж не даёт дефекту размножиться.
 */
const ROOT = process.cwd();
const DIR = path.join(ROOT, 'src/lib/services/bitrix');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('Д-49: services/bitrix/** не импортирует xlsx (SheetJS)', () => {
  it('файлы найдены — обход не сломан', () => {
    expect(walk(DIR).length).toBeGreaterThanOrEqual(5);
  });

  it('ни одного импорта из пакета xlsx', () => {
    const offenders = walk(DIR).filter((f) =>
      /from\s+['"]xlsx['"]|require\(\s*['"]xlsx['"]\s*\)/.test(readSource(f))
    );
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
