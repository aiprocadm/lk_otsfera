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
 *
 * Хотфикс №2 сопровождения (С-5, 05.09.2026): страж читал разметку построчно
 * и молчал, когда prettier переносил подсказку — `Максимум 200{' '}` и `МБ.`
 * на следующей строке проходили как две невинные половинки. Теперь файл
 * сверяется целиком: между словом, цифрой и «МБ» допускаются переводы строк
 * и JSX-пробелы `{' '}` — именно так prettier и рвёт текст.
 */

/** Между словами подсказки: пробелы, переводы строк, JSX-пробел `{' '}`. */
const GAP = String.raw`(?:\s|\{\s*['"] ['"]\s*\})`;
const HARDCODED = new RegExp(String.raw`(Максимум|до|более|предела в)${GAP}+\d+${GAP}*МБ`, 'g');

/** Комментарии стираются, но переводы строк остаются — номера строк не плывут. */
function withoutComments(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const t = line.trim();
      return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') ? '' : line;
    })
    .join('\n');
}

describe('подсказки о размере файла берут цифру из константы', () => {
  it('в разметке компонентов и страниц нет захардкоженного «N МБ» — и через перенос строки тоже', () => {
    const offenders: string[] = [];
    for (const dir of ['components', 'app']) {
      for (const file of walk(join(SRC, dir))) {
        const rel = relative(SRC, file);
        if (rel.startsWith(`__tests__${sep}`)) continue;
        const src = withoutComments(readFileSync(file, 'utf8'));
        for (const m of src.matchAll(HARDCODED)) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${rel}:${line}`);
        }
      }
    }
    expect(offenders, 'цифра предела снова захардкожена в подсказке').toEqual([]);
  });

  it('все документные формы загрузки показывают предел из DEFAULT_MAX_FILE_SIZE_MB', () => {
    for (const rel of [
      join('components', 'partner', 'partner-document-upload-form.tsx'),
      join('components', 'manager', 'manager-doc-upload-form.tsx'),
      join('components', 'manager', 'manager-order-less-upload-form.tsx'),
      join('components', 'organization', 'organization-document-upload-form.tsx'),
      // `У-115`: форма «общего документа» стала общей для заказчика и партнёра.
      join('components', 'documents', 'order-less-upload-form.tsx'),
    ]) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      expect(src, `${rel}: подсказка должна использовать DEFAULT_MAX_FILE_SIZE_MB`).toContain(
        'DEFAULT_MAX_FILE_SIZE_MB'
      );
    }
  });
});
