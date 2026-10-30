import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Страж «уязвимые транзитивные версии не возвращаются» (хотфикс №7
 * сопровождения, решение `Р-26` по вопросу `В-2`, 05.09.2026).
 *
 * `npm audit --omit=dev` показывал 7 уязвимостей, которые «чинятся только
 * мажором» — на деле дырявыми были не сами `next`/`prisma`/`exceljs`, а их
 * транзитивные зависимости с закреплённой старой версией: `postcss@8.4.31`
 * внутри `next`, `uuid@8.3.2` у `exceljs`, `deepmerge-ts@7.1.5` у
 * `@prisma/config`. Секция `overrides` в `package.json` поднимает их до
 * безопасных, мажоры остаются на месте.
 *
 * Страж читает `package-lock.json`: ни одна установленная копия этих
 * пакетов (в любой глубине `node_modules/**`) не ниже безопасного порога, и
 * сами `overrides` на месте — иначе следующий `npm install` их вернёт.
 */

const ROOT = process.cwd();

/** Пакет → минимальная безопасная версия (граница из советов `npm audit`). */
const FLOORS: Record<string, string> = {
  postcss: '8.5.23', // GHSA: уязвимы <=8.5.22
  uuid: '11.1.1', // GHSA-w5hq-g745-h8pq: уязвимы <11.1.1
  'deepmerge-ts': '8.0.0', // GHSA-ggr8-5vv4-36mx: уязвимы <8
  // Хотфикс №24 (09.09.2026): `imapflow@1.5.0` держал у себя `nodemailer@9.0.3`
  // (GHSA-2x7j-588g-ccc2 и др., уязвимы `<=9.1.0`). `У-321` (ТЗ 28.10.2026,
  // `Р-ТР-9`): вся линия 9.x закрыта советами 2026-10 — разбор адресов и
  // ответов SMTP квадратичен (GHSA-v53p-9fqp-m79j, GHSA-prgh-xp8r-p3m5,
  // GHSA-4g23-2xm8-66gc), адрес с `;`/`>` в кавычках рвёт группу получателей
  // (GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h). Уязвимы `<=10.1.3`; override
  // закреплён точной версией, чтобы установка не тянула вчерашний выпуск.
  nodemailer: '10.1.4',
};

/**
 * `У-321`: прямые и транзитивные зависимости без override — их держит сама
 * версия в `package.json`/`package-lock.json`, страж следит, чтобы обновление
 * или откат не вернули уязвимую копию.
 */
const LOCK_FLOORS: Record<string, string> = {
  // GHSA-mchm-gjx6-7h55: обход middleware через tunnel-route Sentry. Уязвимы <10.75.2.
  '@sentry/nextjs': '10.75.2',
  // `npm audit`: уязвимы 1.0.77–1.5.0 (тянули старый nodemailer).
  imapflow: '1.5.1',
  // GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr и др.: подмена схемы и хоста при
  // разборе URI (через ajv у @sentry/webpack-plugin). Уязвимы 3.0.0–3.1.8.
  'fast-uri': '3.1.9',
};

function parse(v: string): number[] {
  return v.split('-')[0]!.split('.').map(Number);
}

/** `a < b` для версий вида x.y.z (pre-release хвост отбрасывается). */
function lt(a: string, b: string): boolean {
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

describe('С-9/В-2: overrides держат транзитивные зависимости выше уязвимых версий', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    overrides?: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string }>;
  };

  it('в package.json есть override для каждого из пакетов списка', () => {
    const missing = Object.keys(FLOORS).filter((name) => !pkg.overrides?.[name]);
    expect(missing, missing.join(', ')).toEqual([]);
  });

  it('в package-lock.json нет ни одной копии ниже безопасного порога', () => {
    const bad: string[] = [];
    for (const [key, entry] of Object.entries(lock.packages)) {
      const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
      const floor = FLOORS[name] ?? LOCK_FLOORS[name];
      if (!floor || !entry.version) continue;
      if (lt(entry.version, floor)) bad.push(`${key}@${entry.version} < ${floor}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('каждый пакет списка действительно установлен (страж не проверяет пустоту)', () => {
    for (const name of [...Object.keys(FLOORS), ...Object.keys(LOCK_FLOORS)]) {
      const keys = Object.keys(lock.packages).filter((k) => k.endsWith(`node_modules/${name}`));
      expect(keys.length, name).toBeGreaterThan(0);
    }
  });
});
