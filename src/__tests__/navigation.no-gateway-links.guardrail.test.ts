import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSource } from './helpers/source';
import { LEGACY_GATEWAYS } from '@/lib/navigation/legacyGateways';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';

/**
 * `У-263` — код не ссылается на адрес-шлюз.
 *
 * **Что такое шлюз.** Раздел переехал, старый адрес остался и уводит на новое
 * место, чтобы сохранённая ссылка не отдала «страница не найдена». Обещание
 * дано **людям** — их закладкам и ссылкам в отправленных письмах. Нашему
 * собственному коду оно не нужно: он знает новый адрес.
 *
 * **Чем плоха ссылка на шлюз изнутри.** Во-первых, человек идёт лишним
 * переходом. Во-вторых — и это важнее — шлюз живёт не дольше 90 дней
 * (`navigation.legacy-gateways`). В день, когда его удалят, каждая такая
 * ссылка приведёт в никуда, и обнаружится это не раньше, чем кто-нибудь по
 * ней нажмёт.
 *
 * **Почему страж, а не отчёт.** Отчёт `npm run report:legacy-links` есть, но
 * его запускают перед удалением шлюза — то есть раз в квартал. Сухой прогон
 * приёмки (этап 10) нашёл две живые ссылки, и обе отчёт пропустил: он искал
 * адрес только в ОДИНАРНЫХ кавычках, а в разметке ссылка пишется атрибутом —
 * `href="/organization/students"`, в двойных. Страж смотрит все три вида
 * кавычек и падает сразу, в том же PR.
 */
const SRC_ROOT = join(process.cwd(), 'src');

/** Все старые адреса из обоих реестров. */
function legacyPaths(): string[] {
  const out = LEGACY_GATEWAYS.map((g) => g.from);
  for (const section of SETTINGS_SECTIONS) {
    for (const legacy of section.legacyHrefs) out.push(legacy.from);
  }
  return [...new Set(out)].sort();
}

function codeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'e2e' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      codeFiles(full, out);
      continue;
    }
    if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Файлы, где упоминание старого адреса — это его работа, а не ссылка:
 * сами реестры и страница-шлюз, которая обязана знать свой адрес.
 */
function isRegistryOrGateway(path: string, legacyHref: string): boolean {
  if (path.includes(join('lib', 'navigation', 'legacyGateways.ts'))) return true;
  if (path.includes(join('lib', 'navigation', 'settings.ts'))) return true;
  if (path.includes(join('lib', 'navigation', 'settingsRedirect.ts'))) return true;
  // Реестр флагов перечисляет маршруты, которые закрывает флаг. Это правило
  // доступа, а не ссылка, по которой пойдёт человек.
  if (path.includes(join('lib', 'featureFlags.ts'))) return true;
  const asFile = legacyHref.replace(/^\//, '').replace(/\?.*$/, '');
  return path.includes(join('app', asFile));
}

/**
 * Ссылается ли исходник на старый адрес.
 *
 * Адрес карточки записан в реестре шаблоном (`/manager/students/[id]`) —
 * буквально его в коде не встретить, поэтому ищем часть до первой скобки.
 * Она же покрывает и список, и карточку.
 */
function mentionsLegacy(src: string, legacyHref: string): boolean {
  const needle = legacyHref.split('[')[0]?.replace(/\/$/, '') ?? legacyHref;
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Адрес в начале строкового литерала любого вида. Хвост ограничиваем, чтобы
  // `/organization/students` не совпал с посторонним `/organization/students-x`.
  return new RegExp(`['"\`]${escaped}(?=['"\`/?#])`).test(src);
}

describe('код не ссылается на адрес-шлюз (У-263)', () => {
  const paths = legacyPaths();
  const files = codeFiles(SRC_ROOT);

  it('реестры шлюзов непусты и файлы найдены', () => {
    expect(paths.length).toBeGreaterThan(10);
    expect(files.length).toBeGreaterThan(500);
  });

  it('шаблон ловит ссылку во всех трёх видах кавычек', () => {
    // Мутация страж проверяет на себе: без этой проверки легко написать
    // выражение, которое не совпадёт ни с чем и будет вечно зелёным.
    expect(mentionsLegacy(`href="/organization/students"`, '/organization/students')).toBe(true);
    expect(mentionsLegacy(`href='/organization/students'`, '/organization/students')).toBe(true);
    expect(mentionsLegacy('`/organization/students/${id}`', '/organization/students/[id]')).toBe(
      true
    );
    expect(mentionsLegacy(`href="/organization/students-x"`, '/organization/students')).toBe(false);
    expect(
      mentionsLegacy(`from '@/lib/services/organization/students'`, '/organization/students')
    ).toBe(false);
  });

  it('ни один файл не ведёт на старый адрес', () => {
    const hits: string[] = [];
    for (const legacy of paths) {
      for (const file of files) {
        if (isRegistryOrGateway(file, legacy)) continue;
        if (!mentionsLegacy(readSource(file), legacy)) continue;
        hits.push(`  ${legacy} ← ${file.slice(file.indexOf('src'))}`);
      }
    }
    expect(
      hits,
      'Эти места ведут на адрес-шлюз вместо настоящего:\n' +
        hits.join('\n') +
        '\n\nЧеловек пойдёт лишним переходом, а в день удаления шлюза (90 дней,\n' +
        '`navigation.legacy-gateways`) ссылка приведёт в никуда. Возьмите новый\n' +
        'адрес из реестра `lib/navigation/legacyGateways.ts` (поле `to`).'
    ).toEqual([]);
  });
});
