import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сторож обязательного `teamMode` (C8, CLAUDE.md §4).
 *
 * `canSeeOrder`/`canSeeDocument` из `managerPolicy` решают, видит ли менеджер
 * заказ. Раньше у аргумента `teamMode` было значение по умолчанию `false`, и
 * забытый аргумент **молча** сужал выборку до «своих заказов»: ни типы, ни
 * ревью этого не показывали. Значение по умолчанию убрано — теперь пропуск
 * ловит компилятор.
 *
 * Тест держит именно это решение: вернуть `= false` легко и незаметно, а
 * сломается от этого не сборка, а видимость данных у живых людей.
 */
const POLICY = join(__dirname, '..', 'lib', 'auth', 'managerPolicy.ts');

describe('teamMode остаётся обязательным аргументом (C8)', () => {
  const src = readFileSync(POLICY, 'utf8');

  it('ни у одной функции политики нет значения по умолчанию для teamMode', () => {
    // Ловим и `teamMode = false`, и `teamMode=false`, и `teamMode = true`.
    expect(src, 'у teamMode снова появилось значение по умолчанию').not.toMatch(
      /teamMode\s*=\s*(true|false)/
    );
  });

  it('обе функции объявляют teamMode как обязательный boolean', () => {
    for (const fn of ['canSeeOrder', 'canSeeDocument']) {
      const start = src.indexOf(`export function ${fn}(`);
      expect(start, `${fn} пропала из managerPolicy`).toBeGreaterThan(-1);
      const signature = src.slice(start, src.indexOf('): boolean {', start));
      expect(signature, `${fn}: teamMode должен быть обязательным boolean`).toMatch(
        /teamMode:\s*boolean/
      );
    }
  });
});
