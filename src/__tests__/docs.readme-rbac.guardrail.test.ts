import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { protectedPrefixes } from '@/lib/auth/access';
import type { Role } from '@/lib/auth/jwt';

/**
 * `У-260` (дефект `Д-42`) — таблица RBAC в README обязана совпадать с кодом.
 *
 * Что было. README обещал администратору вход в `/partner/*` и
 * `/organization/*`, хотя `protectedPrefixes` пускает туда только свою роль
 * (Model A). Роли `leader` в таблице не было вовсе — при том что руководитель
 * существует как самостоятельная роль с 18.08.2026 и работает в двух
 * кабинетах. Документ пережил две программы и ввёл бы в заблуждение любого,
 * кто стал бы по нему проверять доступ.
 *
 * Почему страж, а не «поправить и следить». Текст в README не связан с кодом
 * ничем, кроме внимательности: правка `access.ts` не заставляет открыть
 * README. Поэтому таблица здесь **собирается из `protectedPrefixes`** и
 * сравнивается с файлом. Разошлись — красная сборка.
 *
 * Страж намеренно импортирует `protectedPrefixes` как значение, а не читает
 * `access.ts` текстом: разбор исходника регулярками — это второй источник
 * правды, который сам умеет ошибаться (и мимо которого проходит, например,
 * ветка, добавленная программно).
 */
const REPO_ROOT = join(__dirname, '..', '..');

/** Путь пишется в самом вызове чтения: так видно, что читается разметка, а не код. */
function readReadme(): string {
  return readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
}

/**
 * Порядок ролей в шапке. Зафиксирован, а не выведен из типа: в таблице он
 * должен быть стабильным от прогона к прогону, иначе страж краснел бы на
 * перестановке, ничего не значащей для смысла.
 */
const ROLE_COLUMNS: Role[] = ['admin', 'leader', 'manager', 'partner', 'organization', 'student'];

/** Таблица в том же виде, в каком она лежит в README. */
function buildTable(): string {
  const header = `| Route prefix | ${ROLE_COLUMNS.join(' | ')} |`;
  const sep = `| --- | ${ROLE_COLUMNS.map(() => '---').join(' | ')} |`;
  const rows = Object.keys(protectedPrefixes)
    .sort()
    .map((prefix) => {
      const allowed = protectedPrefixes[prefix] ?? [];
      const cells = ROLE_COLUMNS.map((r) => (allowed.includes(r) ? '✅' : '❌'));
      return `| \`${prefix}/*\` | ${cells.join(' | ')} |`;
    });
  return [header, sep, ...rows].join('\n');
}

describe('README: RBAC-матрица собрана из кода (У-260)', () => {
  it('таблица Web routes совпадает с protectedPrefixes', () => {
    const readme = readReadme();
    const expected = buildTable();
    expect(
      readme,
      'Таблица «Web routes» в README разошлась с `protectedPrefixes` (src/lib/auth/access.ts).\n' +
        'Замените её на эту:\n\n' +
        expected +
        '\n'
    ).toContain(expected);
  });

  it('в шапке таблицы есть все шесть ролей, включая leader', () => {
    // Отдельной проверкой, потому что именно пропуск роли и был дефектом:
    // таблица без `leader` выглядела бы «совпавшей», если бы сравнение шло
    // только по строкам существующих колонок.
    const readme = readReadme();
    for (const role of ROLE_COLUMNS) {
      expect(readme, `в шапке таблицы RBAC нет роли ${role}`).toContain(`| ${role} |`);
    }
  });

  it('README не обещает админу вход в кабинеты партнёра и заказчика', () => {
    // Проверка ОТСУТСТВИЯ конкретной лжи: даже если таблицу однажды перепишут
    // руками, старое обещание не должно вернуться незамеченным.
    const readme = readReadme();
    for (const prefix of ['/partner', '/organization']) {
      const allowed = protectedPrefixes[prefix] ?? [];
      expect(allowed, `Model A нарушен: admin попал в ${prefix}`).not.toContain('admin');
      const row = readme
        .split('\n')
        .find((l) => l.startsWith(`| \`${prefix}/*\` |`))
        ?.split('|')
        .map((c) => c.trim());
      // Колонка admin — вторая после «Route prefix» (индекс 2 с учётом пустого
      // элемента перед первым разделителем).
      expect(row?.[2], `README всё ещё пускает admin в ${prefix}`).toBe('❌');
    }
  });
});
