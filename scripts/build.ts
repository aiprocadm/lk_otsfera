/**
 * `npm run build` — обёртка над `next build` с поднятым лимитом памяти.
 *
 * **Зачем обёртка, а не просто `next build`.** У Node **умолчание кучи —
 * 4288 МБ**, и это потолок 64-битной сборки, а не свойство машины: на сервере
 * с 47 ГБ ОЗУ значение ровно то же. Проверке типов внутри `next build` этого
 * не хватает — она упирается в предел и падает так:
 *
 * ```
 * FATAL ERROR: Ineffective mark-compacts near heap limit
 * Allocation failed - JavaScript heap out of memory
 * Next.js build worker exited with code: null and signal: SIGABRT
 * ```
 *
 * Причём **компиляция к этому моменту уже прошла** («Compiled successfully»),
 * поэтому падение выглядит как поломка кода, хотя код исправен. Найдено
 * прогоном сопровождения №30 (19.09.2026); до того `build` в этом проекте
 * ломался «сам по себе» при зелёных тестах — в CHANGELOG есть запись о двух
 * сутках такой поломки.
 *
 * **Почему `NODE_OPTIONS`, а не `node --max-old-space-size=… next`.** Память
 * кончается не у самого `next build`, а у его **рабочего процесса** проверки
 * типов (`Next.js build worker`). Флаг командной строки родителя дочернему
 * процессу не передаётся, а переменная окружения — передаётся. Именно поэтому
 * приём `lint`/`typecheck` (`node --max-old-space-size=N ./node_modules/…`)
 * здесь не сработал бы.
 *
 * **Почему не строка `NODE_OPTIONS=… next build` прямо в package.json.**
 * Такая запись работает только в POSIX-оболочке, а у проекта есть и
 * Windows-сценарии (`dev:stack`). Обёртка на `tsx` кроссплатформенна — тот же
 * приём, что у [gate.ts](gate.ts). И, что важнее, в файле помещается
 * объяснение: без него следующий человек «упростит» настройку обратно и
 * вернёт падение.
 *
 * Уже заданный снаружи `NODE_OPTIONS` уважается — к нему добавляется флаг,
 * если его там нет.
 */
import { spawnSync } from 'node:child_process';

const HEAP_MB = 8192;
const FLAG = `--max-old-space-size=${HEAP_MB}`;

/** Существующие опции Node + наш флаг, если его ещё нет. */
function nodeOptions(current: string | undefined): string {
  const existing = (current ?? '').trim();
  if (existing.includes('--max-old-space-size')) return existing;
  return existing ? `${existing} ${FLAG}` : FLAG;
}

const result = spawnSync('next', ['build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, NODE_OPTIONS: nodeOptions(process.env.NODE_OPTIONS) },
});

if (result.error) {
  console.error('[build] не удалось запустить next build:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
