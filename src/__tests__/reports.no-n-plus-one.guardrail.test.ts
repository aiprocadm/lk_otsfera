import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSource } from './helpers/source';

/**
 * СТРАЖ `У-248` (этап 7): в расчётах показателей и отчётов нет выборок в цикле.
 *
 * Отчёт за месяц на ста тысячах заказов обязан уложиться в две секунды. Убивает
 * его не объём данных, а одна строчка вида «для каждого менеджера спросим базу»:
 * сто запросов вместо одного, и никакой индекс уже не спасает.
 *
 * Страж читает исходники и ищет `await prisma.…` **внутри** цикла или `.map`.
 * Это текстовая проверка, и её предел записан честно: вынесенный в отдельную
 * функцию запрос, которую зовут в цикле, она не увидит. Поэтому рядом живёт
 * интеграционный тест с тайм-лимитом — он ловит то, что текст пропускает.
 *
 * Мутация (проверено): вписать `for (const m of managers) { await prisma.… }`
 * в любой файл `lib/kpi/**` или `lib/reports/**` → страж краснеет.
 */
const ROOTS = ['src/lib/kpi', 'src/lib/reports', 'src/lib/services/leader'];

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Каталог появляется вместе со своим PR — отсутствие не ошибка.
    return [];
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Строки вида `for (…)`, `.map(`, `.forEach(` — начало цикла. */
const LOOP_START = /\b(for\s*\(|\.map\s*\(|\.forEach\s*\(|while\s*\()/;
/** Обращение к базе внутри. */
const DB_CALL = /await\s+(prisma|tx)\./;

describe('страж: в отчётах и показателях нет выборок в цикле (У-248)', () => {
  const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r)));

  it('есть что проверять — иначе страж охраняет пустоту', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('ни один запрос к базе не стоит внутри цикла', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readSource(file).split('\n');
      let depth = 0;
      let loopDepth = -1;
      lines.forEach((line, i) => {
        if (loopDepth === -1 && LOOP_START.test(line)) loopDepth = depth;
        // Считаем скобки: выход из блока цикла снимает пометку.
        depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        if (loopDepth !== -1 && depth <= loopDepth) loopDepth = -1;
        if (loopDepth !== -1 && DB_CALL.test(line)) {
          offenders.push(`${file.replace(process.cwd(), '')}:${i + 1} — ${line.trim()}`);
        }
      });
    }
    expect(offenders, 'запрос к базе внутри цикла: отчёт станет N запросами').toEqual([]);
  });
});
