import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Компоненты в базу не ходят: запросы живут в services, данные приходят
 * пропсами (§2, правило `components-no-db` в `.dependency-cruiser.cjs`).
 *
 * Этот страж дублирует правило dependency-cruiser юнит-тестом намеренно:
 * `npm run boundaries` физически не запускается на машинах без установленного
 * `depcruise`, и при выключенном CI к 26.08.2026 в `main` молча накопилось
 * десять компонентов с прямым импортом prisma (найдено адверсариальным ревью
 * PR #436, вычищено хотфиксом). Юнит-слой гоняется всегда — pre-push и CI, —
 * поэтому регресс теперь виден сразу.
 */
const COMPONENTS_ROOT = join(__dirname, '..', 'components');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe('components-no-db: src/components/** не импортирует src/lib/db', () => {
  it('ни один компонент не тянет prisma-клиент', () => {
    const files = walk(COMPONENTS_ROOT);
    // Смок против пустого обхода: страж, которому нечего проверять, зелёный
    // не потому, что всё хорошо, а потому, что он смотрит не туда.
    expect(files.length).toBeGreaterThan(100);

    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf-8');
      // Ловим и статический import, и dynamic import(), и require —
      // value- И type-импорт: типовую зависимость на клиент тащить тоже нельзя
      // (тип PrismaClient живёт в '@prisma/client', он границу не нарушает).
      return /from\s+['"]@\/lib\/db\b|import\(\s*['"]@\/lib\/db\b|require\(\s*['"]@\/lib\/db\b|from\s+['"](?:\.\.\/)+lib\/db\b/.test(
        src
      );
    });

    expect(
      offenders.map((f) => f.slice(f.indexOf('src/'))),
      'Компонент импортирует базу напрямую — подними выборку в page.tsx или ' +
        'сервис (эталон: components/settings/requisites-screen.tsx, PR #436) и ' +
        'передай данные пропсами:\n'
    ).toEqual([]);
  });
});
