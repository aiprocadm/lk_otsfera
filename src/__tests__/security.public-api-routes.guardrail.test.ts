import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { PUBLIC_API_ROUTES } from '@/lib/api/publicRoutes';
import { readSource } from './helpers/source';

/**
 * Страж публичных API-адресов (`У-211`, `У-217`, решение `Р-3-8`).
 *
 * Требование просило «публичный роут в allow-list middleware с причиной». У
 * middleware такого списка для API нет: его matcher исключает `/api/*`
 * целиком. Поэтому смысл требования — «пополнить список открытых наружу
 * дверей нельзя молча» — держит этот страж, а не matcher.
 *
 * Сверка идёт В ОБЕ СТОРОНЫ, и это важно:
 * - роут без проверки сессии, которого нет в реестре, — незаявленная дыра;
 * - запись в реестре у роута, где проверка на самом деле есть, — ложная
 *   тревога, которая со временем приучает не верить списку.
 *
 * Исходники читаются через `readSource` (снимает комментарии): иначе
 * упоминание `requireSession` в пояснении сошло бы за настоящий гард.
 *
 * Проверено мутацией: роут без гарда, не внесённый в реестр, роняет первый
 * тест; лишняя запись в реестре — второй.
 */

const API_ROOT = join('src', 'app', 'api');

/** Чем роут может защищаться, кроме сессии: секретом вебхука или токеном. */
const GUARD_MARKERS = [
  'requireSession',
  'requireManager',
  'requireAdmin',
  'requireRole',
  'requireSettingsSection',
  'requireManagerLeader',
  'requireOrganization',
  'requirePartner',
  'getSession',
  'withAuth',
];

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

/** `src/app/api/public/requests/route.ts` → `/api/public/requests`. */
function urlOf(file: string): string {
  const rel = file.split(`src${sep}app${sep}`)[1] ?? file;
  return '/' + rel.replace(new RegExp(`\\${sep}`, 'g'), '/').replace(/\/route\.ts$/, '');
}

function hasGuard(code: string): boolean {
  return GUARD_MARKERS.some((marker) => code.includes(marker));
}

describe('публичные API-адреса объявлены явно', () => {
  const files = routeFiles(API_ROOT);
  const declared = new Set(PUBLIC_API_ROUTES.map((r) => r.path));

  it('роут без проверки сессии обязан быть в реестре публичных', () => {
    const undeclared = files
      .filter((file) => !hasGuard(readSource(file)))
      .map(urlOf)
      .filter((url) => !declared.has(url));

    expect(
      undeclared,
      `Эти адреса открыты наружу и нигде не объявлены. Добавьте их в PUBLIC_API_ROUTES с причиной либо поставьте проверку доступа:\n${undeclared.join('\n')}`
    ).toEqual([]);
  });

  it('в реестре нет адресов, у которых проверка доступа на самом деле есть', () => {
    const byUrl = new Map(files.map((f) => [urlOf(f), f]));
    const stale: string[] = [];
    for (const route of PUBLIC_API_ROUTES) {
      const file = byUrl.get(route.path);
      if (!file) {
        stale.push(`${route.path} — такого роута нет в коде`);
        continue;
      }
      if (hasGuard(readSource(file))) {
        stale.push(`${route.path} — у роута есть проверка доступа, запись лишняя`);
      }
    }
    expect(stale, `Реестр публичных адресов разошёлся с кодом:\n${stale.join('\n')}`).toEqual([]);
  });

  it('у каждого объявленного адреса есть внятная причина', () => {
    for (const route of PUBLIC_API_ROUTES) {
      expect(route.reason.trim().length, `${route.path}: причина пустая`).toBeGreaterThan(30);
    }
  });
});
