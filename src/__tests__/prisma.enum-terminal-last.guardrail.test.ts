import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TERMINAL, enumValues, liveAfterTerminal } from './helpers/enumOrder';

/**
 * Страж «терминальные статусы — в конце enum, доски сортируют по статусу»
 * (решение `Р-27` по вопросу `В-3`, сопровождение 05.09.2026).
 *
 * Доски сделок, воронки и задач берут `BOARD_CAP` карточек с
 * `orderBy: [{ status: 'asc' }, { createdAt: 'desc' }]`. Postgres сортирует
 * enum по порядку объявления, поэтому «открытые первыми» держится только
 * пока в `schema.prisma` терминальные значения (`won`/`lost`,
 * `promoted_*`/`rejected`, `done`) стоят после всех живых. Новое живое
 * значение, дописанное в конец, отправило бы открытые карточки за предел
 * раньше закрытых — страж это ловит. (Живую базу проверяет
 * `boards.status-order.integration`: `ALTER TYPE … ADD VALUE` без `BEFORE`
 * дописывает значение в конец независимо от схемы.)
 */

const ROOT = process.cwd();
const SCHEMA = readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8');

const BOARD_SERVICES = [
  'src/lib/services/deals/board.ts',
  'src/lib/services/funnel/board.ts',
  'src/lib/services/tasks/board.ts',
];

describe('Р-27: терминальные статусы объявлены в конце enum', () => {
  it.each(Object.entries(TERMINAL))('%s', (name, terminal) => {
    const values = enumValues(SCHEMA, name);
    expect(values.length, `enum ${name} не найден в schema.prisma`).toBeGreaterThan(0);
    for (const t of terminal) expect(values, `${name}.${t}`).toContain(t);
    const bad = liveAfterTerminal(values, terminal);
    expect(bad, `живые значения после терминальных в ${name}: ${bad.join(', ')}`).toEqual([]);
  });
});

describe('Р-27: доски сортируют по статусу, потом по дате', () => {
  it.each(BOARD_SERVICES)('%s', (file) => {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    expect(src).toMatch(/orderBy: \[\{ status: 'asc' \}, \{ createdAt: 'desc' \}\]/);
    expect(src).toMatch(/take: BOARD_CAP/);
    // Счётчик по тому же условию — иначе подпись «показаны N из M» соврёт.
    expect(src).toMatch(/\.count\(\{ where \}\)/);
  });
});
