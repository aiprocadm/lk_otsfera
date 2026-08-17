import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Подсказка о размере файла не может врать (задел STATUS.md, починка 17.08.2026).
 *
 * До починки цифра предела жила в трёх несогласованных видах: формы
 * организации писали «200 МБ» (из константы, но server action резал на 25),
 * а формы партнёра и менеджера — захардкоженное «20 МБ», не совпадающее ни с
 * конфигом (200), ни с реальным пределом. Цифра в подсказке обязана приходить
 * из `DEFAULT_MAX_FILE_SIZE_MB` (lib/config/upload) — тогда она одна на всех
 * и меняется в одном месте.
 *
 * Страж запрещает захардкоженную цифру рядом с «МБ» в UI-разметке
 * (`Максимум N МБ», «до N МБ», «предела в N МБ»); комментарии не считаются.
 */
describe('подсказки о размере файла берут цифру из константы', () => {
  it('в разметке компонентов и страниц нет захардкоженного «N МБ»', () => {
    const offenders: string[] = [];
    const HARDCODED = /(Максимум|до|более|предела в)\s+\d+\s*МБ/;
    for (const dir of ['components', 'app']) {
      for (const file of walk(join(SRC, dir))) {
        const rel = relative(SRC, file);
        if (rel.startsWith(`__tests__${sep}`)) continue;
        const lines = readFileSync(file, 'utf8').split('\n');
        for (const [i, line] of lines.entries()) {
          const t = line.trim();
          if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
          if (HARDCODED.test(line)) offenders.push(`${rel}:${i + 1}`);
        }
      }
    }
    expect(offenders, 'цифра предела снова захардкожена в подсказке').toEqual([]);
  });

  it('все пять документных форм загрузки показывают предел из DEFAULT_MAX_FILE_SIZE_MB', () => {
    for (const rel of [
      join('components', 'partner', 'partner-document-upload-form.tsx'),
      join('components', 'manager', 'manager-doc-upload-form.tsx'),
      join('components', 'manager', 'manager-order-less-upload-form.tsx'),
      join('components', 'organization', 'organization-document-upload-form.tsx'),
      join('components', 'organization', 'organization-order-less-upload-form.tsx'),
    ]) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      expect(src, `${rel}: подсказка должна использовать DEFAULT_MAX_FILE_SIZE_MB`).toContain(
        'DEFAULT_MAX_FILE_SIZE_MB'
      );
    }
  });
});
