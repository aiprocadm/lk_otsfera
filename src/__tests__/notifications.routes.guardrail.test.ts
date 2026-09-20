import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  notificationRoute,
  NOTIFICATION_ROUTE_CABINETS,
  NOTIFICATION_ROUTE_GAPS,
  NOTIFICATION_ROUTE_TYPES,
} from '@/lib/notifications/routes';
import { NOTIFICATION_TYPES, notificationTypesForRole } from '@/lib/notifications/registry';
import { notificationHref } from '@/lib/notifications/href';

/**
 * СТРАЖ `У-232` (решение `Р-Э5-7`): у каждой пары «тип × роль» есть адрес,
 * и этот адрес существует в `src/app` как страница; `null` допустим только
 * для пар из явного списка `NOTIFICATION_ROUTE_GAPS`; руководитель получает
 * `/leader/…`, а не `/manager/…`, кроме разделов, которых у него нет.
 *
 * Мутации (проверено 17.09.2026): направить руководителя в `/manager/orders`
 * → «руководитель ходит в свой кабинет»; вычеркнуть пару из списка пробелов →
 * «null только из явного списка»; опечатка в сегменте пути → «адрес существует».
 */

const APP = join(process.cwd(), 'src', 'app');

/** Meta с идентификаторами всех известных ключей — чтобы каждый маршрут построился. */
const FULL_META = {
  orderId: 'o1',
  taskId: 't1',
  dialogId: 'd1',
  documentId: 'doc1',
  requestId: 'r1',
  statementId: 's1',
  organizationId: 'org1',
  sourceType: 'dialog',
  sourceId: 'd1',
  entity: 'task',
  entityId: 't1',
  kind: 'push_document_failed',
};

function pageExists(path: string): boolean {
  const clean = path.split('?')[0]!.split('#')[0]!;
  const segments = clean.split('/').filter(Boolean);
  // Динамический сегмент — любой каталог в квадратных скобках на этом уровне.
  let dir = APP;
  for (const seg of segments) {
    const direct = join(dir, seg);
    if (existsSync(direct)) {
      dir = direct;
      continue;
    }
    const dyn = readdirSync(dir).find((n) => n.startsWith('[') && n.endsWith(']'));
    if (!dyn) return false;
    dir = join(dir, dyn);
  }
  return existsSync(join(dir, 'page.tsx'));
}

const gaps = new Set(NOTIFICATION_ROUTE_GAPS.map(([t, c]) => `${t}|${c}`));

describe('страж: таблица маршрутов уведомлений (У-232)', () => {
  it('в таблице каждый тип реестра и ничего лишнего', () => {
    expect([...NOTIFICATION_ROUTE_TYPES].sort()).toEqual(Object.keys(NOTIFICATION_TYPES).sort());
  });

  it('каждая адресованная пара «тип × роль» даёт существующую страницу, null — только из явного списка', () => {
    const missing: string[] = [];
    const unexpectedNull: string[] = [];
    const gapButRouted: string[] = [];
    const staleGaps: string[] = [];
    const addressed = new Set<string>();
    for (const cab of NOTIFICATION_ROUTE_CABINETS) {
      // Только пары, где тип роли адресован (реестр): чужие типы роль не получает.
      for (const type of notificationTypesForRole(cab)) {
        addressed.add(`${type}|${cab}`);
        const path = notificationRoute(type, FULL_META, cab);
        const key = `${type}|${cab}`;
        if (path === null) {
          if (!gaps.has(key)) unexpectedNull.push(key);
          continue;
        }
        if (gaps.has(key)) gapButRouted.push(`${key} → ${path}`);
        if (!pageExists(path)) missing.push(`${key} → ${path}`);
      }
    }
    for (const key of gaps) if (!addressed.has(key)) staleGaps.push(key);
    expect(missing, 'адрес ведёт на несуществующую страницу').toEqual([]);
    expect(unexpectedNull, 'null не из явного списка пробелов').toEqual([]);
    expect(gapButRouted, 'пара в списке пробелов, а адрес есть — список устарел').toEqual([]);
    expect(staleGaps, 'в списке пробелов пара, которую роль и так не получает').toEqual([]);
  });

  it('руководитель ходит в свой кабинет; чужой — только для разделов, которых у него нет', () => {
    const foreign: string[] = [];
    for (const type of NOTIFICATION_ROUTE_TYPES) {
      const path = notificationRoute(type, FULL_META, 'leader');
      if (!path) continue;
      if (path.startsWith('/leader/')) continue;
      // Записанное исключение: «Мессенджеры», «Входящие», «Звонки» — играющий тренер.
      if (/^\/manager\/(messengers|inbox|calls)(\/|\?|$)/.test(path)) continue;
      foreign.push(`${type} → ${path}`);
    }
    expect(foreign).toEqual([]);
    expect(notificationRoute('task_assigned', { taskId: 't1' }, 'leader')).toBe('/leader/tasks/t1');
    expect(notificationRoute('comment_from_org', { orderId: 'o1' }, 'leader')).toBe(
      '/leader/orders/o1'
    );
  });

  it('слушатель и незнакомая роль — всегда null', () => {
    expect(notificationRoute('task_assigned', FULL_META, 'student')).toBeNull();
    expect(notificationRoute('task_assigned', FULL_META, 'robot')).toBeNull();
    expect(notificationRoute('нет_такого_типа', FULL_META, 'manager')).toBeNull();
  });

  it('без идентификатора — список раздела, а не битая карточка', () => {
    expect(notificationRoute('task_assigned', {}, 'manager')).toBe('/manager/tasks');
    expect(notificationRoute('document_uploaded_by_org', { orderId: null }, 'manager')).toBe(
      '/manager/documents?tab=general'
    );
    expect(
      notificationRoute('sla_escalation', { sourceType: 'inbound', sourceId: 'm1' }, 'manager')
    ).toBe('/manager/inbox?message=m1');
  });

  it('href: сотрудникам таблица важнее старого url в строке, клиентам — наоборот', () => {
    // Старая строка руководителя с `/manager/…` в meta.url — лечится таблицей.
    expect(
      notificationHref('leader', 'comment_from_org', { orderId: 'o1', url: '/manager/orders/o1' })
    ).toBe('/leader/orders/o1');
    // Заказчик: особый адрес продьюсера сохраняется.
    expect(
      notificationHref('organization', 'requisites_requested', {
        url: '/organization/settings?x=1',
      })
    ).toBe('/organization/settings?x=1');
    // Клиент без url — таблица.
    expect(notificationHref('organization', 'payment_received', { orderId: 'o1' })).toBe(
      '/organization/orders/o1'
    );
    // Внешняя ссылка: только локальная часть, без хоста.
    expect(
      notificationHref('partner', 'commission_statement_ready', {
        url: 'https://evil.example/partner/finance?p=1',
      })
    ).toBe('/partner/finance?p=1');
    expect(notificationHref('partner', 'commission_statement_ready', { url: '//evil' })).toBe(
      '/partner/finance'
    );
  });
});

describe('страж: раздел «Сообщения» есть у ОБОИХ клиентских кабинетов', () => {
  it('иначе ссылка из уведомления об ответе менеджера ведёт в никуда', () => {
    // Правило `inbound_reply` строит адрес от раздела «Сообщения» и опирается
    // на то, что он объявлен и у заказчика, и у партнёра. Уберут у одного —
    // ссылка из уведомления перестанет открываться, а человек решит, что ему
    // не ответили. Поэтому инвариант проверяется здесь, а не догадкой в коде.
    for (const cabinet of ['organization', 'partner'] as const) {
      expect(notificationRoute('inbound_reply', { dialogId: 'd1' }, cabinet), cabinet).toBe(
        `/${cabinet}/messages?tab=manager&dialog=d1`
      );
      expect(notificationRoute('inbound_reply', {}, cabinet), cabinet).toBe(
        `/${cabinet}/messages?tab=manager`
      );
    }
  });
});
