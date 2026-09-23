import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSource } from './helpers/source';
import { REMOVED_PATHS, isRemovedPath } from '@/lib/navigation/removedPaths';
import {
  notificationRoute,
  NOTIFICATION_ROUTE_CABINETS,
  NOTIFICATION_ROUTE_TYPES,
} from '@/lib/notifications/routes';
import { notificationHref } from '@/lib/notifications/href';

/**
 * `У-263` — код не ведёт на удалённый адрес.
 *
 * **Что было.** Раздел переезжал, старый адрес оставался «шлюзом» и уводил на
 * новое место. Шлюзы удалены решением заказчика 23.09.2026 (прогон
 * сопровождения №37): старый адрес отвечает 404 «раздел переехал». Любая
 * ссылка на него из кода теперь ведёт в никуда — и обнаружится это не раньше,
 * чем кто-нибудь по ней нажмёт.
 *
 * **Список замороженный** (`lib/navigation/removedPaths.ts`): страницы
 * удалены, а адрес помнится, чтобы на него не сослались снова — по памяти или
 * копированием из старого кода.
 *
 * Страж смотрит три места, где ссылка рождается:
 * 1. строковые литералы кода (все три вида кавычек: `href="/…"` в разметке
 *    пишется в двойных — отчёт, искавший только одинарные, однажды пропустил
 *    две живые ссылки);
 * 2. таблицу маршрутов уведомлений — там адрес собирается из кусков
 *    (`/${кабинет}/${раздел}`) и текстом не ищется: так у партнёра жил раздел
 *    `deals`, который собрал бы `/partner/deals`;
 * 3. сохранённую в базе ссылку уведомления (`meta.url`) — её пишут на годы
 *    вперёд, и удалённый адрес в ней остаётся навсегда.
 */
const SRC_ROOT = join(process.cwd(), 'src');

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

/** Сам список удалённых адресов — единственное место, где им положено быть. */
const REGISTRY = join('lib', 'navigation', 'removedPaths.ts');

/**
 * Ссылается ли исходник на удалённый адрес: адрес в начале строкового
 * литерала любого вида. Хвост ограничиваем, чтобы `/organization/students` не
 * совпал с посторонним `/organization/students-x`.
 */
function mentionsRemoved(src: string, path: string): boolean {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`['"\`]${escaped}(?=['"\`/?#])`).test(src);
}

/** Идентификаторы всех ключей meta — чтобы каждый маршрут построился. */
const IDS = {
  orderId: 'o1',
  taskId: 't1',
  dialogId: 'd1',
  documentId: 'doc1',
  requestId: 'r1',
  statementId: 's1',
  organizationId: 'org1',
  entityId: 'e1',
  sourceId: 's1',
};
const ENTITIES = [
  'task',
  'order',
  'dialog',
  'lead',
  'deal',
  'document',
  'client_request',
  'payment',
  'organization',
  'enrollment',
  'other',
];
const KINDS = ['push_document_failed', 'push_lead_failed', 'other'];
const SOURCES = ['client_request', 'enrollment', 'inbound', 'call', 'dialog', 'other'];

/** Все сочетания «сущность × вид × источник», с идентификаторами и без. */
function metas(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{}];
  for (const entity of ENTITIES) {
    for (const kind of KINDS) {
      for (const sourceType of SOURCES) {
        out.push({ ...IDS, entity, kind, sourceType });
        out.push({ entity, kind, sourceType });
      }
    }
  }
  return out;
}

describe('код не ведёт на удалённый адрес (У-263)', () => {
  const files = codeFiles(SRC_ROOT);

  it('список удалённых адресов непуст и файлы найдены', () => {
    expect(REMOVED_PATHS.length).toBeGreaterThan(20);
    expect(files.length).toBeGreaterThan(500);
  });

  it('шаблон ловит ссылку во всех трёх видах кавычек', () => {
    // Мутация страж проверяет на себе: без этой проверки легко написать
    // выражение, которое не совпадёт ни с чем и будет вечно зелёным.
    expect(mentionsRemoved(`href="/organization/students"`, '/organization/students')).toBe(true);
    expect(mentionsRemoved(`href='/partner/team'`, '/partner/team')).toBe(true);
    expect(mentionsRemoved('`/organization/students/${id}`', '/organization/students')).toBe(true);
    expect(mentionsRemoved(`'/partner/settings?tab=team'`, '/partner/team')).toBe(false);
    expect(mentionsRemoved(`href="/organization/students-x"`, '/organization/students')).toBe(
      false
    );
    expect(
      mentionsRemoved(`from '@/lib/services/organization/students'`, '/organization/students')
    ).toBe(false);
  });

  it('ни один файл не ведёт на удалённый адрес', () => {
    const hits: string[] = [];
    for (const { path, movedTo } of REMOVED_PATHS) {
      for (const file of files) {
        if (file.endsWith(REGISTRY)) continue;
        if (!mentionsRemoved(readSource(file), path)) continue;
        hits.push(`  ${path} ← ${file.slice(file.indexOf('src'))} (теперь: ${movedTo})`);
      }
    }
    expect(
      hits,
      'Эти места ведут на удалённый адрес — человек попадёт на 404:\n' +
        hits.join('\n') +
        '\n\nВозьмите новый адрес (он указан в скобках).'
    ).toEqual([]);
  });

  it('таблица маршрутов уведомлений не собирает удалённый адрес', () => {
    const bad = new Set<string>();
    for (const type of NOTIFICATION_ROUTE_TYPES) {
      for (const cabinet of NOTIFICATION_ROUTE_CABINETS) {
        for (const meta of metas()) {
          const route = notificationRoute(type, meta, cabinet);
          if (route && isRemovedPath(route)) bad.add(`${type} × ${cabinet} → ${route}`);
        }
      }
    }
    expect([...bad], 'уведомление поведёт в 404').toEqual([]);
  });

  it('сохранённая ссылка уведомления на удалённый адрес не используется', () => {
    // Заказчику и партнёру `meta.url` важнее таблицы — старая строка в базе
    // отправила бы их в 404. Вместо неё — адрес по таблице.
    expect(
      notificationHref('partner', 'payment_received', { url: '/partner/deals/o1', orderId: 'o1' })
    ).toBe('/partner/orders/o1');
    expect(
      notificationHref('organization', 'order_status_changed', {
        url: 'https://lk.example/organization/team?x=1',
        orderId: 'o1',
      })
    ).toBe('/organization/orders/o1');
    // Сотруднику — тоже: при пустой таблице ссылки нет, а не ссылка в 404.
    expect(notificationHref('admin', 'нет_такого_типа', { url: '/admin/sync' })).toBeNull();
    // Живой адрес с похожим началом — не удалённый.
    expect(
      notificationHref('admin', 'нет_такого_типа', {
        url: '/admin/settings/security/personal-data',
      })
    ).toBe('/admin/settings/security/personal-data');
  });
});
