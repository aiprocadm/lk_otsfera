import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
    // Ловим все написания: `teamMode = false`, `teamMode=false` и — главное —
    // `teamMode: boolean = false`. Первая версия стража пропускала именно
    // последнее, самое вероятное: тип на месте, а дефолт вернулся. Проверено
    // мутацией: без аннотации в шаблоне страж молчал на сломанном коде.
    expect(src, 'у teamMode снова появилось значение по умолчанию').not.toMatch(
      /teamMode\s*(?::\s*boolean\s*)?=\s*(true|false)/
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

/**
 * Этап 1 ТЗ 12.09.2026 (`У-187`): то же правило для скоупа контактов и
 * заметок. Сервисы контактов принимают `teamMode` третьим аргументом; дефолт
 * `= false` молча сузил бы справочник до закреплённых организаций у всех, кто
 * забыл аргумент. Проверено мутацией: `teamMode: boolean = false` в
 * `scope.ts` роняет первый тест, отсутствие аннотации — второй.
 */
const CONTACT_DIRS = [
  join(__dirname, '..', 'lib', 'services', 'contacts'),
  join(__dirname, '..', 'lib', 'services', 'organizationNotes'),
];

describe('teamMode обязателен в сервисах контактов и заметок (У-187)', () => {
  const files = CONTACT_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => ({ name: f, src: readFileSync(join(dir, f), 'utf8') }))
  );

  it('ни в одном файле у teamMode нет значения по умолчанию', () => {
    for (const { name, src } of files) {
      expect(src, `${name}: у teamMode появилось значение по умолчанию`).not.toMatch(
        /teamMode\s*(?::\s*boolean\s*)?=\s*(true|false)/
      );
    }
  });

  it('каждая экспортируемая функция контактов, принимающая teamMode, объявляет его обязательным boolean', () => {
    const scope = files.find((f) => f.name === 'scope.ts')!;
    for (const fn of ['contactScopeWhere', 'isContactInScope', 'canBindOrganization']) {
      const start = scope.src.indexOf(`export function ${fn}(`);
      expect(start, `${fn} пропала из scope.ts`).toBeGreaterThan(-1);
      const signature = scope.src.slice(start, scope.src.indexOf(')', start));
      expect(signature, `${fn}: teamMode должен быть обязательным boolean`).toMatch(
        /teamMode:\s*boolean/
      );
    }
    // Все сервисы, где teamMode встречается в сигнатуре, — только как `teamMode: boolean`.
    for (const { name, src } of files) {
      for (const m of src.matchAll(/teamMode(\??)\s*:/g)) {
        expect(m[1], `${name}: teamMode не может быть необязательным`).toBe('');
      }
    }
  });
});
